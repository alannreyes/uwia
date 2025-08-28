import { Injectable, Logger } from '@nestjs/common';
import { claudeConfig } from '../../../config/model.config';

export interface ClaudeRateLimitState {
  requestTimestamps: number[];
  inputTokensUsed: { timestamp: number; tokens: number }[];
  outputTokensUsed: { timestamp: number; tokens: number }[];
  consecutiveFailures: number;
  lastFailureTime: number;
  circuitBreakerUntil: number;
  totalRequests: number;
  successfulRequests: number;
  rateLimitHits: number;
}

@Injectable()
export class ClaudeRateLimiterService {
  private readonly logger = new Logger(ClaudeRateLimiterService.name);
  
  private state: ClaudeRateLimitState = {
    requestTimestamps: [],
    inputTokensUsed: [],
    outputTokensUsed: [],
    consecutiveFailures: 0,
    lastFailureTime: 0,
    circuitBreakerUntil: 0,
    totalRequests: 0,
    successfulRequests: 0,
    rateLimitHits: 0
  };

  /**
   * Ejecuta una operación de Claude respetando rate limits específicos
   */
  async executeWithClaudeRateLimit<T>(
    operation: () => Promise<T & { usage?: { input_tokens?: number; output_tokens?: number } }>,
    operationName: string,
    estimatedInputTokens: number = 1000,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<T> {
    
    // Verificar circuit breaker
    if (this.isCircuitBreakerOpen()) {
      const waitTime = Math.ceil((this.state.circuitBreakerUntil - Date.now()) / 1000);
      throw new Error(`Claude circuit breaker open. Service unavailable for ${waitTime} seconds.`);
    }

    this.state.totalRequests++;
    
    // Pre-flight checks de rate limiting
    await this.waitForRateLimit(estimatedInputTokens);
    
    let attempt = 0;
    const maxRetries = claudeConfig.rateLimits.maxRetries;
    
    while (attempt <= maxRetries) {
      try {
        this.logger.log(`🤖 Executing Claude operation: ${operationName} (attempt ${attempt + 1})`);
        
        const result = await operation();
        
        // Registrar uso exitoso
        this.recordSuccessfulRequest(result.usage);
        this.state.successfulRequests++;
        this.state.consecutiveFailures = 0;
        
        // Cerrar circuit breaker si estaba abierto
        if (this.state.circuitBreakerUntil > Date.now()) {
          this.state.circuitBreakerUntil = 0;
          this.logger.log('✅ Claude circuit breaker closed after successful request');
        }
        
        return result;
        
      } catch (error) {
        this.logger.error(`❌ Claude operation failed (${operationName}, attempt ${attempt + 1}): ${error.message}`);
        
        if (!this.isRetryableError(error) || attempt >= maxRetries) {
          this.recordFailure(error);
          throw error;
        }
        
        attempt++;
        const delay = this.calculateRetryDelay(attempt, error);
        this.logger.warn(`⏳ Retrying Claude operation ${operationName} in ${delay}ms`);
        
        await this.sleep(delay);
      }
    }
    
    // Esto no debería alcanzarse, pero por si acaso
    throw new Error(`Max retries exceeded for Claude operation: ${operationName}`);
  }

  /**
   * Espera hasta que sea seguro hacer una request según rate limits
   */
  private async waitForRateLimit(estimatedInputTokens: number): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Limpiar timestamps antiguos
    this.cleanOldTimestamps();
    
    // Verificar RPM limit
    if (this.state.requestTimestamps.length >= claudeConfig.rateLimits.rpm) {
      this.state.rateLimitHits++;
      const oldestRequest = this.state.requestTimestamps[0];
      const waitTime = 60000 - (now - oldestRequest) + 1000; // +1s buffer
      
      this.logger.warn(`📊 Claude RPM limit reached (${this.state.requestTimestamps.length}/${claudeConfig.rateLimits.rpm}). Waiting ${waitTime}ms`);
      
      if (waitTime > 0) {
        await this.sleep(waitTime);
        return this.waitForRateLimit(estimatedInputTokens); // Re-check
      }
    }
    
    // Verificar Input TPM limit
    const inputTokensInLastMinute = this.state.inputTokensUsed
      .filter(record => record.timestamp > oneMinuteAgo)
      .reduce((sum, record) => sum + record.tokens, 0);
      
    if (inputTokensInLastMinute + estimatedInputTokens > claudeConfig.rateLimits.itpm) {
      this.state.rateLimitHits++;
      const oldestTokenUse = this.state.inputTokensUsed
        .filter(record => record.timestamp > oneMinuteAgo)[0];
      
      if (oldestTokenUse) {
        const waitTime = 60000 - (now - oldestTokenUse.timestamp) + 1000;
        this.logger.warn(`🔤 Claude ITPM limit would be exceeded (${inputTokensInLastMinute + estimatedInputTokens}/${claudeConfig.rateLimits.itpm}). Waiting ${waitTime}ms`);
        
        if (waitTime > 0) {
          await this.sleep(waitTime);
          return this.waitForRateLimit(estimatedInputTokens);
        }
      }
    }
    
    // Registrar la request
    this.state.requestTimestamps.push(now);
  }

  /**
   * Limpia timestamps antiguos para mantener solo el último minuto
   */
  private cleanOldTimestamps(): void {
    const oneMinuteAgo = Date.now() - 60000;
    
    this.state.requestTimestamps = this.state.requestTimestamps
      .filter(ts => ts > oneMinuteAgo);
    
    this.state.inputTokensUsed = this.state.inputTokensUsed
      .filter(record => record.timestamp > oneMinuteAgo);
    
    this.state.outputTokensUsed = this.state.outputTokensUsed
      .filter(record => record.timestamp > oneMinuteAgo);
  }

  /**
   * Registra el uso de tokens después de una request exitosa
   */
  private recordSuccessfulRequest(usage?: { input_tokens?: number; output_tokens?: number }): void {
    const now = Date.now();
    
    if (usage?.input_tokens) {
      this.state.inputTokensUsed.push({
        timestamp: now,
        tokens: usage.input_tokens
      });
    }
    
    if (usage?.output_tokens) {
      this.state.outputTokensUsed.push({
        timestamp: now,
        tokens: usage.output_tokens
      });
    }
    
    // Mantener solo los últimos 100 registros por eficiencia
    if (this.state.inputTokensUsed.length > 100) {
      this.state.inputTokensUsed.shift();
    }
    if (this.state.outputTokensUsed.length > 100) {
      this.state.outputTokensUsed.shift();
    }
  }

  /**
   * Registra un fallo y maneja circuit breaker
   */
  private recordFailure(error: any): void {
    this.state.consecutiveFailures++;
    this.state.lastFailureTime = Date.now();
    
    // Activar circuit breaker después de 3 fallos consecutivos (Claude es más sensible)
    if (this.state.consecutiveFailures >= 3) {
      const breakerDuration = Math.min(
        60000 * Math.pow(2, this.state.consecutiveFailures - 3), // Exponential backoff
        300000 // Máximo 5 minutos
      );
      
      this.state.circuitBreakerUntil = Date.now() + breakerDuration;
      
      this.logger.error(`⚡ Claude circuit breaker OPENED for ${breakerDuration/1000}s after ${this.state.consecutiveFailures} consecutive failures`);
    }
  }

  /**
   * Verifica si el circuit breaker está abierto
   */
  private isCircuitBreakerOpen(): boolean {
    return this.state.circuitBreakerUntil > Date.now();
  }

  /**
   * Determina si un error de Claude es reintentable
   */
  private isRetryableError(error: any): boolean {
    const retryablePatterns = [
      /rate.*limit/i,
      /too.*many.*request/i,
      /429/,
      /500/,
      /502/,
      /503/,
      /504/,
      /timeout/i,
      /network/i,
      /connection/i,
      /ECONNRESET/,
      /ETIMEDOUT/,
      /overloaded_error/i,
      /api_error/i
    ];
    
    const errorMessage = error.message || error.toString();
    const statusCode = error.status || error.statusCode;
    
    // Verificar status codes retryables
    if ([429, 500, 502, 503, 504].includes(statusCode)) {
      return true;
    }
    
    // Verificar patrones en el mensaje
    return retryablePatterns.some(pattern => pattern.test(errorMessage));
  }

  /**
   * Calcula el delay para reintentos con backoff exponencial
   */
  private calculateRetryDelay(attempt: number, error: any): number {
    // Si el error tiene retry-after header, respetarlo
    const retryAfter = error.headers?.['retry-after'];
    if (retryAfter) {
      const retryAfterMs = parseInt(retryAfter) * 1000;
      this.logger.log(`📅 Using Retry-After header: ${retryAfterMs}ms`);
      return Math.min(retryAfterMs, claudeConfig.rateLimits.maxDelay);
    }
    
    // Backoff exponencial más agresivo para Claude
    const baseDelay = claudeConfig.rateLimits.baseDelay;
    const delay = Math.min(
      baseDelay * Math.pow(2, attempt - 1), // 15s, 30s, 60s, 120s...
      claudeConfig.rateLimits.maxDelay
    );
    
    // Jitter del 20% para evitar thundering herd
    const jitter = delay * 0.2 * Math.random();
    return Math.floor(delay + jitter);
  }

  /**
   * Utility para dormir
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtiene estadísticas actuales del rate limiter
   */
  getStats(): {
    rpm: { used: number; limit: number };
    itpm: { used: number; limit: number };
    otpm: { used: number; limit: number };
    circuitBreaker: { open: boolean; resetIn?: number };
    consecutiveFailures: number;
    successRate: number;
    rateLimitHits: number;
  } {
    this.cleanOldTimestamps();
    
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    const inputTokensUsed = this.state.inputTokensUsed
      .filter(record => record.timestamp > oneMinuteAgo)
      .reduce((sum, record) => sum + record.tokens, 0);
      
    const outputTokensUsed = this.state.outputTokensUsed
      .filter(record => record.timestamp > oneMinuteAgo)
      .reduce((sum, record) => sum + record.tokens, 0);
    
    const successRate = this.state.totalRequests > 0 
      ? (this.state.successfulRequests / this.state.totalRequests) * 100 
      : 0;
    
    return {
      rpm: {
        used: this.state.requestTimestamps.length,
        limit: claudeConfig.rateLimits.rpm
      },
      itpm: {
        used: inputTokensUsed,
        limit: claudeConfig.rateLimits.itpm
      },
      otpm: {
        used: outputTokensUsed,
        limit: claudeConfig.rateLimits.otpm
      },
      circuitBreaker: {
        open: this.isCircuitBreakerOpen(),
        resetIn: this.isCircuitBreakerOpen() 
          ? Math.ceil((this.state.circuitBreakerUntil - now) / 1000)
          : undefined
      },
      consecutiveFailures: this.state.consecutiveFailures,
      successRate: Math.round(successRate * 100) / 100,
      rateLimitHits: this.state.rateLimitHits
    };
  }

  /**
   * Imprime estadísticas detalladas
   */
  logStats(): void {
    const stats = this.getStats();
    
    this.logger.log('📊 === CLAUDE RATE LIMITER STATS ===');
    this.logger.log(`🔄 RPM: ${stats.rpm.used}/${stats.rpm.limit}`);
    this.logger.log(`📝 Input TPM: ${stats.itpm.used.toLocaleString()}/${stats.itpm.limit.toLocaleString()}`);
    this.logger.log(`📤 Output TPM: ${stats.otpm.used.toLocaleString()}/${stats.otpm.limit.toLocaleString()}`);
    this.logger.log(`⚡ Circuit Breaker: ${stats.circuitBreaker.open ? 'OPEN' : 'CLOSED'}`);
    if (stats.circuitBreaker.resetIn) {
      this.logger.log(`   ↳ Resets in ${stats.circuitBreaker.resetIn}s`);
    }
    this.logger.log(`❌ Consecutive Failures: ${stats.consecutiveFailures}`);
    this.logger.log(`✅ Success Rate: ${stats.successRate}%`);
    this.logger.log(`📊 Rate Limit Hits: ${stats.rateLimitHits}`);
    this.logger.log('📊 ====================================');
  }

  /**
   * Resetea manualmente el circuit breaker y estadísticas
   */
  reset(): void {
    this.state = {
      requestTimestamps: [],
      inputTokensUsed: [],
      outputTokensUsed: [],
      consecutiveFailures: 0,
      lastFailureTime: 0,
      circuitBreakerUntil: 0,
      totalRequests: 0,
      successfulRequests: 0,
      rateLimitHits: 0
    };
    this.logger.log('🔄 Claude rate limiter reset');
  }
}