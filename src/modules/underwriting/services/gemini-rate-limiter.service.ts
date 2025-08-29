import { Injectable, Logger } from '@nestjs/common';
import { geminiConfig } from '../../../config/gemini.config';

export interface GeminiRateLimitState {
  requestTimestamps: number[];
  tokensUsed: { timestamp: number; tokens: number }[];
  consecutiveFailures: number;
  lastFailureTime: number;
  circuitBreakerUntil: number;
  totalRequests: number;
  successfulRequests: number;
  rateLimitHits: number;
}

@Injectable()
export class GeminiRateLimiterService {
  private readonly logger = new Logger(GeminiRateLimiterService.name);
  
  private state: GeminiRateLimitState = {
    requestTimestamps: [],
    tokensUsed: [],
    consecutiveFailures: 0,
    lastFailureTime: 0,
    circuitBreakerUntil: 0,
    totalRequests: 0,
    successfulRequests: 0,
    rateLimitHits: 0
  };

  /**
   * Ejecuta una operación de Gemini respetando rate limits específicos
   * Sigue el mismo patrón que ClaudeRateLimiterService
   */
  async executeWithGeminiRateLimit<T>(
    operation: () => Promise<T & { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }>,
    operationName: string,
    estimatedTokens: number = 1000,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<T> {
    
    // Verificar circuit breaker
    if (this.isCircuitBreakerOpen()) {
      const waitTime = Math.ceil((this.state.circuitBreakerUntil - Date.now()) / 1000);
      throw new Error(`Gemini circuit breaker open. Service unavailable for ${waitTime} seconds.`);
    }

    this.state.totalRequests++;
    
    // Pre-flight checks de rate limiting
    await this.waitForRateLimit(estimatedTokens, priority);
    
    const startTime = Date.now();
    
    try {
      // Ejecutar operación
      const result = await this.executeWithRetry(operation, operationName);
      
      // Registrar éxito
      this.recordSuccessfulRequest(Date.now(), result.usage?.total_tokens || estimatedTokens);
      this.state.successfulRequests++;
      this.state.consecutiveFailures = 0;
      
      const duration = Date.now() - startTime;
      this.logger.log(`✅ Gemini ${operationName} exitoso en ${duration}ms (${result.usage?.total_tokens || estimatedTokens} tokens)`);
      
      return result;
      
    } catch (error) {
      // Manejar error y circuit breaker
      this.recordFailedRequest();
      
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Gemini ${operationName} falló después de ${duration}ms: ${error.message}`);
      
      throw error;
    }
  }

  /**
   * Verifica límites de rate y espera si es necesario
   */
  private async waitForRateLimit(estimatedTokens: number, priority: string): Promise<void> {
    const now = Date.now();
    
    // Limpiar timestamps antiguos
    this.cleanOldTimestamps(now);
    
    // Verificar RPM
    const currentRPM = this.state.requestTimestamps.length;
    if (currentRPM >= geminiConfig.rateLimits.rpm) {
      const oldestRequest = Math.min(...this.state.requestTimestamps);
      const waitUntil = oldestRequest + 60000; // 1 minuto
      const waitTime = Math.max(0, waitUntil - now);
      
      if (waitTime > 0) {
        this.logger.warn(`⏳ Gemini RPM limit reached (${currentRPM}/${geminiConfig.rateLimits.rpm}). Waiting ${waitTime}ms`);
        this.state.rateLimitHits++;
        await this.sleep(waitTime);
      }
    }
    
    // Verificar TPM (Tokens Per Minute)
    const currentTPM = this.calculateCurrentTPM(now);
    if (currentTPM + estimatedTokens > geminiConfig.rateLimits.tpm) {
      const oldestToken = this.state.tokensUsed.reduce((oldest, current) => 
        current.timestamp < oldest.timestamp ? current : oldest
      );
      const waitUntil = oldestToken.timestamp + 60000;
      const waitTime = Math.max(0, waitUntil - now);
      
      if (waitTime > 0) {
        this.logger.warn(`⏳ Gemini TPM limit would be exceeded (${currentTPM + estimatedTokens}/${geminiConfig.rateLimits.tpm}). Waiting ${waitTime}ms`);
        this.state.rateLimitHits++;
        await this.sleep(waitTime);
      }
    }
  }

  /**
   * Ejecuta operación con reintentos automáticos
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = geminiConfig.rateLimits.maxRetries
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt > maxRetries) {
          break;
        }
        
        // Verificar si es un error de rate limit
        if (this.isRateLimitError(error)) {
          const backoffDelay = this.calculateBackoffDelay(attempt);
          this.logger.warn(`🔄 Gemini rate limited on attempt ${attempt}. Retrying in ${backoffDelay}ms`);
          this.state.rateLimitHits++;
          await this.sleep(backoffDelay);
          continue;
        }
        
        // Verificar si es un error temporal
        if (this.isTemporaryError(error)) {
          const backoffDelay = this.calculateBackoffDelay(attempt);
          this.logger.warn(`🔄 Gemini temporary error on attempt ${attempt}. Retrying in ${backoffDelay}ms: ${error.message}`);
          await this.sleep(backoffDelay);
          continue;
        }
        
        // Error no recuperable
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * Registra request exitoso
   */
  private recordSuccessfulRequest(timestamp: number, actualTokens: number): void {
    this.state.requestTimestamps.push(timestamp);
    this.state.tokensUsed.push({ timestamp, tokens: actualTokens });
  }

  /**
   * Registra request fallido
   */
  private recordFailedRequest(): void {
    this.state.consecutiveFailures++;
    this.state.lastFailureTime = Date.now();
    
    // Activar circuit breaker después de 5 fallos consecutivos
    if (this.state.consecutiveFailures >= geminiConfig.circuitBreakerThreshold) {
      this.state.circuitBreakerUntil = Date.now() + geminiConfig.rateLimits.maxDelay;
      this.logger.error(`🚨 Gemini circuit breaker activated after ${this.state.consecutiveFailures} consecutive failures`);
    }
  }

  /**
   * Verifica si circuit breaker está abierto
   */
  private isCircuitBreakerOpen(): boolean {
    return Date.now() < this.state.circuitBreakerUntil;
  }

  /**
   * Limpia timestamps antiguos (>1 minuto)
   */
  private cleanOldTimestamps(now: number): void {
    const oneMinuteAgo = now - 60000;
    
    this.state.requestTimestamps = this.state.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    this.state.tokensUsed = this.state.tokensUsed.filter(tu => tu.timestamp > oneMinuteAgo);
  }

  /**
   * Calcula TPM actual
   */
  private calculateCurrentTPM(now: number): number {
    const oneMinuteAgo = now - 60000;
    return this.state.tokensUsed
      .filter(tu => tu.timestamp > oneMinuteAgo)
      .reduce((total, tu) => total + tu.tokens, 0);
  }

  /**
   * Verifica si es error de rate limit
   */
  private isRateLimitError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    const status = error.status || error.statusCode || 0;
    
    return (
      status === 429 ||
      message.includes('rate limit') ||
      message.includes('quota exceeded') ||
      message.includes('too many requests')
    );
  }

  /**
   * Verifica si es error temporal
   */
  private isTemporaryError(error: any): boolean {
    const status = error.status || error.statusCode || 0;
    const message = error.message?.toLowerCase() || '';
    
    return (
      status >= 500 ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('network') ||
      message.includes('temporary')
    );
  }

  /**
   * Calcula delay de backoff exponencial
   */
  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = geminiConfig.rateLimits.baseDelay;
    const maxDelay = geminiConfig.rateLimits.maxDelay;
    
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    
    // Añadir jitter para evitar thundering herd
    const jitter = Math.random() * 0.1 * delay;
    
    return delay + jitter;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Método de conveniencia para verificar límites (compatible con sistema existente)
   */
  async checkLimit(operationType: string): Promise<void> {
    const now = Date.now();
    this.cleanOldTimestamps(now);
    
    // Solo verificar, no hacer wait
    const currentRPM = this.state.requestTimestamps.length;
    if (currentRPM >= geminiConfig.rateLimits.rpm) {
      throw new Error(`Gemini RPM limit exceeded: ${currentRPM}/${geminiConfig.rateLimits.rpm}`);
    }
  }

  /**
   * Obtiene estadísticas actuales
   */
  getStats(): any {
    const now = Date.now();
    this.cleanOldTimestamps(now);
    
    const currentRPM = this.state.requestTimestamps.length;
    const currentTPM = this.calculateCurrentTPM(now);
    const successRate = this.state.totalRequests > 0 
      ? (this.state.successfulRequests / this.state.totalRequests * 100).toFixed(1)
      : '100.0';
    
    return {
      limits: {
        rpm: geminiConfig.rateLimits.rpm,
        tpm: geminiConfig.rateLimits.tpm,
      },
      current: {
        rpm: currentRPM,
        tpm: currentTPM,
      },
      stats: {
        totalRequests: this.state.totalRequests,
        successfulRequests: this.state.successfulRequests,
        successRate: `${successRate}%`,
        rateLimitHits: this.state.rateLimitHits,
        consecutiveFailures: this.state.consecutiveFailures,
        circuitBreakerOpen: this.isCircuitBreakerOpen(),
      }
    };
  }

  /**
   * Reset de estadísticas (útil para testing)
   */
  resetStats(): void {
    this.state = {
      requestTimestamps: [],
      tokensUsed: [],
      consecutiveFailures: 0,
      lastFailureTime: 0,
      circuitBreakerUntil: 0,
      totalRequests: 0,
      successfulRequests: 0,
      rateLimitHits: 0
    };
  }
}