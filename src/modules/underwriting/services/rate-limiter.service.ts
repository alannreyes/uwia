import { Injectable, Logger } from '@nestjs/common';

export interface RateLimitConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  requestsPerMinute: number;
  maxQueueSize: number;
  maxWaitTimeMs: number;
}

export interface RetryableError extends Error {
  isRetryable: boolean;
  statusCode?: number;
  retryAfter?: number;
}

export interface QueuedRequest<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  operationName: string;
  priority: 'high' | 'normal' | 'low';
  queuedAt: number;
  timeout?: number;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private requestQueue: QueuedRequest<any>[] = [];
  private requestTimestamps: number[] = [];
  private isProcessing = false;
  private consecutiveFailures = 0;
  private circuitBreakerOpen = false;
  private circuitBreakerResetTime: number = 0;
  private queueProcessorRunning = false;

  // Métricas de rendimiento
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retriesCount: 0,
    averageResponseTime: 0,
    queueWaitTimes: [] as number[],
    requestsByPriority: { high: 0, normal: 0, low: 0 },
    circuitBreakerActivations: 0,
    rateLimitHits: 0
  };

  private readonly config: RateLimitConfig = {
    maxRetries: 10,
    baseDelay: 10000, // 10 segundos
    maxDelay: 60000,  // 60 segundos
    backoffMultiplier: 1.5,
    jitter: true,
    requestsPerMinute: 60, // Aumentado para mejor throughput
    maxQueueSize: 200, // Aumentado para manejar más requests concurrentes
    maxWaitTimeMs: 120000 // 2 minutos máximo de espera (reducido)
  };

  /**
   * Ejecuta una función con rate limiting y retry logic usando cola con backpressure
   */
  async executeWithRateLimit<T>(
    operation: () => Promise<T>,
    operationName: string,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<T> {
    // Circuit breaker check
    if (this.circuitBreakerOpen && Date.now() < this.circuitBreakerResetTime) {
      const waitTime = Math.ceil((this.circuitBreakerResetTime - Date.now()) / 1000);
      this.logger.warn(`⚡ Circuit breaker OPEN for ${operationName}. Reset in ${waitTime}s`);
      throw new Error(`Circuit breaker open. Service temporarily unavailable. Retry in ${waitTime} seconds`);
    }

    // Backpressure control - rechazar si la cola está llena
    if (this.requestQueue.length >= this.config.maxQueueSize) {
      this.logger.error(`🚫 Queue overflow - rejecting ${operationName}. Queue size: ${this.requestQueue.length}`);
      throw new Error(`Rate limiter queue is full (${this.config.maxQueueSize}). Too many concurrent requests.`);
    }

    return new Promise<T>((resolve, reject) => {
      // Tracking de métricas
      this.metrics.totalRequests++;
      this.metrics.requestsByPriority[priority]++;

      const queuedRequest: QueuedRequest<T> = {
        operation: async () => {
          const operationStart = Date.now();
          try {
            const result = await operation();
            
            // Métricas de éxito
            this.metrics.successfulRequests++;
            const responseTime = Date.now() - operationStart;
            this.updateAverageResponseTime(responseTime);
            
            return result;
          } catch (error) {
            this.metrics.failedRequests++;
            throw error;
          }
        },
        resolve: (value: T) => {
          // Calcular tiempo de espera en cola
          const queueWaitTime = Date.now() - queuedRequest.queuedAt;
          this.metrics.queueWaitTimes.push(queueWaitTime);
          
          // Mantener solo los últimos 100 tiempos de espera
          if (this.metrics.queueWaitTimes.length > 100) {
            this.metrics.queueWaitTimes.shift();
          }
          
          resolve(value);
        },
        reject,
        operationName,
        priority,
        queuedAt: Date.now(),
        timeout: Date.now() + this.config.maxWaitTimeMs
      };

      // Insertar en cola según prioridad
      this.insertByPriority(queuedRequest);
      
      this.logger.log(`📋 Queued ${operationName} (priority: ${priority}, queue size: ${this.requestQueue.length})`);
      
      // Iniciar procesador si no está corriendo
      if (!this.queueProcessorRunning) {
        this.startQueueProcessor();
      }
    });
  }

  /**
   * Inserta request en cola según prioridad
   */
  private insertByPriority<T>(request: QueuedRequest<T>): void {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    const requestPriority = priorityOrder[request.priority];
    
    let insertIndex = this.requestQueue.length;
    for (let i = 0; i < this.requestQueue.length; i++) {
      const queuedPriority = priorityOrder[this.requestQueue[i].priority];
      if (requestPriority < queuedPriority) {
        insertIndex = i;
        break;
      }
    }
    
    this.requestQueue.splice(insertIndex, 0, request);
  }

  /**
   * Procesador de cola con backpressure
   */
  private async startQueueProcessor(): Promise<void> {
    if (this.queueProcessorRunning) return;
    
    this.queueProcessorRunning = true;
    this.logger.log('🔄 Starting queue processor');
    
    try {
      while (this.requestQueue.length > 0) {
        this.logger.log(`🔄 Processing queue, ${this.requestQueue.length} items remaining`);
        
        // Limpiar requests expirados
        this.cleanExpiredRequests();
        
        if (this.requestQueue.length === 0) {
          this.logger.log('📭 Queue is empty after cleanup');
          break;
        }
        
        const request = this.requestQueue.shift()!;
        this.logger.log(`🚀 Processing request: ${request.operationName}`);
        
        try {
          // Rate limiting check antes de procesar
          this.logger.log(`⏳ Checking rate limit for ${request.operationName}`);
          await this.waitForRateLimit();
          this.logger.log(`✅ Rate limit check passed for ${request.operationName}`);
          
          // Ejecutar con retry logic
          this.logger.log(`🔄 Executing with retry: ${request.operationName}`);
          const result = await this.executeWithRetry(
            request.operation, 
            request.operationName, 
            0
          );
          
          this.logger.log(`✅ Request completed successfully: ${request.operationName}`);
          request.resolve(result);
          
        } catch (error) {
          this.logger.error(`❌ Failed to execute ${request.operationName}: ${error.message}`);
          request.reject(error);
        }
        
        // Small delay entre requests para prevenir spam
        this.logger.log(`⏱️ Waiting 100ms before next request`);
        await this.sleep(100);
      }
    } catch (error) {
      this.logger.error(`💥 Queue processor crashed: ${error.message}`, error.stack);
    } finally {
      this.queueProcessorRunning = false;
      this.logger.log('⏹️ Queue processor stopped');
    }
  }

  /**
   * Limpia requests expirados de la cola
   */
  private cleanExpiredRequests(): void {
    const now = Date.now();
    const originalLength = this.requestQueue.length;
    
    this.requestQueue = this.requestQueue.filter(request => {
      if (request.timeout && now > request.timeout) {
        this.logger.warn(`⏰ Request ${request.operationName} expired after ${this.config.maxWaitTimeMs}ms`);
        request.reject(new Error(`Request timeout after ${this.config.maxWaitTimeMs}ms in queue`));
        return false;
      }
      return true;
    });
    
    const removed = originalLength - this.requestQueue.length;
    if (removed > 0) {
      this.logger.warn(`🧹 Cleaned ${removed} expired requests from queue`);
    }
  }

  /**
   * Ejecuta con reintentos y backoff exponencial
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    attemptNumber: number
  ): Promise<T> {
    this.logger.log(`🔄 executeWithRetry called for ${operationName}, attempt ${attemptNumber}`);
    
    try {
      // Rate limiting check
      this.logger.log(`⏳ Secondary rate limit check for ${operationName}`);
      await this.waitForRateLimit();
      this.logger.log(`✅ Secondary rate limit check passed for ${operationName}`);

      // Log attempt y tracking de retries
      if (attemptNumber > 0) {
        this.metrics.retriesCount++;
        this.logger.log(`🔄 Retry attempt ${attemptNumber}/${this.config.maxRetries} for ${operationName}`);
      } else {
        this.logger.log(`🚀 First attempt for ${operationName}`);
      }

      // Execute operation
      this.logger.log(`📞 Calling operation function for ${operationName}`);
      const result = await operation();
      this.logger.log(`✅ Operation completed successfully for ${operationName}`);
      
      // Success - reset failure counter
      this.consecutiveFailures = 0;
      if (this.circuitBreakerOpen) {
        this.circuitBreakerOpen = false;
        this.logger.log(`✅ Circuit breaker CLOSED - service recovered`);
      }

      return result;

    } catch (error) {
      const isRetryable = this.isRetryableError(error);
      
      this.logger.error(`❌ Error in ${operationName} (attempt ${attemptNumber + 1}): ${error.message}`);
      this.logger.error(`❌ Error stack: ${error.stack}`);

      // Check if we should retry
      if (!isRetryable || attemptNumber >= this.config.maxRetries) {
        this.logger.error(`❌ Cannot retry ${operationName}: isRetryable=${isRetryable}, attemptNumber=${attemptNumber}, maxRetries=${this.config.maxRetries}`);
        this.handleFailure(error, operationName);
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = this.calculateDelay(attemptNumber, error);
      
      this.logger.warn(`⏳ Waiting ${delay}ms before retry ${attemptNumber + 1} for ${operationName}`);
      await this.sleep(delay);
      this.logger.warn(`⏰ Retry delay completed for ${operationName}`);

      // Recursive retry
      this.logger.warn(`🔁 Starting retry ${attemptNumber + 1} for ${operationName}`);
      return this.executeWithRetry(operation, operationName, attemptNumber + 1);
    }
  }

  /**
   * Gestiona el rate limiting basado en tokens por minuto
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    this.logger.log(`🔍 Rate limit check: now=${now}, oneMinuteAgo=${oneMinuteAgo}`);

    // Limpiar timestamps antiguos
    const oldLength = this.requestTimestamps.length;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    this.logger.log(`🧹 Cleaned timestamps: ${oldLength} → ${this.requestTimestamps.length}`);

    // Si estamos en el límite, esperar
    if (this.requestTimestamps.length >= this.config.requestsPerMinute) {
      this.metrics.rateLimitHits++;
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = 60000 - (now - oldestTimestamp) + 1000; // +1s de buffer
      
      this.logger.warn(`📊 Rate limit reached (${this.requestTimestamps.length}/${this.config.requestsPerMinute} requests). Waiting ${waitTime}ms`);
      this.logger.warn(`📊 Oldest timestamp: ${oldestTimestamp}, age: ${now - oldestTimestamp}ms`);
      
      if (waitTime > 0) {
        this.logger.warn(`⏰ Sleeping for ${waitTime}ms`);
        await this.sleep(waitTime);
        this.logger.warn(`⏰ Sleep completed, rechecking...`);
      } else {
        this.logger.warn(`⏰ No need to wait (waitTime: ${waitTime}ms)`);
      }
      
      // Recursive call para re-verificar
      this.logger.warn(`🔁 Recursive rate limit check...`);
      return this.waitForRateLimit();
    }

    // Registrar este request
    this.logger.log(`✅ Rate limit OK: ${this.requestTimestamps.length}/${this.config.requestsPerMinute} requests`);
    this.requestTimestamps.push(now);
    this.logger.log(`📝 Registered request timestamp: ${now}`);
  }

  /**
   * Determina si un error es recuperable
   */
  private isRetryableError(error: any): boolean {
    // OpenAI specific error codes
    const retryableStatusCodes = [429, 500, 502, 503, 504];
    const retryableMessages = [
      'rate limit',
      'rate_limit',
      'too many requests',
      'timeout',
      'network',
      'ECONNRESET',
      'ETIMEDOUT',
      'service_unavailable'
    ];

    // Check status code
    if (error.status && retryableStatusCodes.includes(error.status)) {
      return true;
    }

    if (error.statusCode && retryableStatusCodes.includes(error.statusCode)) {
      return true;
    }

    // Check error message
    const errorMessage = (error.message || '').toLowerCase();
    return retryableMessages.some(msg => errorMessage.includes(msg));
  }

  /**
   * Calcula el delay con exponential backoff y jitter
   */
  private calculateDelay(attemptNumber: number, error: any): number {
    let delay = this.config.baseDelay;

    // Si el error incluye retry-after header
    if (error.retryAfter) {
      delay = error.retryAfter * 1000;
    } else {
      // Exponential backoff
      delay = Math.min(
        this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attemptNumber),
        this.config.maxDelay
      );
    }

    // Add jitter para evitar thundering herd
    if (this.config.jitter) {
      const jitterRange = delay * 0.3; // 30% jitter
      const jitter = Math.random() * jitterRange - jitterRange / 2;
      delay += jitter;
    }

    return Math.floor(delay);
  }

  /**
   * Maneja fallos consecutivos y circuit breaker
   */
  private handleFailure(error: any, operationName: string): void {
    this.consecutiveFailures++;

    // Activar circuit breaker después de 5 fallos consecutivos
    if (this.consecutiveFailures >= 5 && !this.circuitBreakerOpen) {
      this.metrics.circuitBreakerActivations++;
      this.circuitBreakerOpen = true;
      this.circuitBreakerResetTime = Date.now() + 60000; // Reset en 1 minuto
      this.logger.error(`⚡ Circuit breaker OPENED after ${this.consecutiveFailures} consecutive failures`);
    }

    // Log estadísticas
    this.logger.error(`📈 Failure stats for ${operationName}:`);
    this.logger.error(`   - Consecutive failures: ${this.consecutiveFailures}`);
    this.logger.error(`   - Circuit breaker: ${this.circuitBreakerOpen ? 'OPEN' : 'CLOSED'}`);
    this.logger.error(`   - Recent requests: ${this.requestTimestamps.length} in last minute`);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtiene estadísticas del rate limiter
   */
  getStats(): {
    requestsInLastMinute: number;
    circuitBreakerStatus: 'open' | 'closed';
    consecutiveFailures: number;
    queueLength: number;
  } {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentRequests = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);

    return {
      requestsInLastMinute: recentRequests.length,
      circuitBreakerStatus: this.circuitBreakerOpen ? 'open' : 'closed',
      consecutiveFailures: this.consecutiveFailures,
      queueLength: this.requestQueue.length
    };
  }

  /**
   * Obtiene métricas detalladas de rendimiento
   */
  getPerformanceMetrics(): {
    totalRequests: number;
    successRate: number;
    failureRate: number;
    averageResponseTime: number;
    averageQueueWaitTime: number;
    retryRate: number;
    requestsByPriority: { high: number; normal: number; low: number };
    circuitBreakerActivations: number;
    rateLimitHits: number;
    currentQueueSize: number;
    uptime: string;
  } {
    const successRate = this.metrics.totalRequests > 0 
      ? (this.metrics.successfulRequests / this.metrics.totalRequests) * 100 
      : 0;
    
    const failureRate = this.metrics.totalRequests > 0 
      ? (this.metrics.failedRequests / this.metrics.totalRequests) * 100 
      : 0;
    
    const retryRate = this.metrics.totalRequests > 0 
      ? (this.metrics.retriesCount / this.metrics.totalRequests) * 100 
      : 0;
    
    const averageQueueWaitTime = this.metrics.queueWaitTimes.length > 0
      ? this.metrics.queueWaitTimes.reduce((a, b) => a + b, 0) / this.metrics.queueWaitTimes.length
      : 0;

    return {
      totalRequests: this.metrics.totalRequests,
      successRate: Math.round(successRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      averageResponseTime: Math.round(this.metrics.averageResponseTime),
      averageQueueWaitTime: Math.round(averageQueueWaitTime),
      retryRate: Math.round(retryRate * 100) / 100,
      requestsByPriority: { ...this.metrics.requestsByPriority },
      circuitBreakerActivations: this.metrics.circuitBreakerActivations,
      rateLimitHits: this.metrics.rateLimitHits,
      currentQueueSize: this.requestQueue.length,
      uptime: process.uptime() ? `${Math.floor(process.uptime() / 60)} minutes` : 'unknown'
    };
  }

  /**
   * Actualiza el tiempo promedio de respuesta
   */
  private updateAverageResponseTime(newResponseTime: number): void {
    if (this.metrics.averageResponseTime === 0) {
      this.metrics.averageResponseTime = newResponseTime;
    } else {
      // Promedio móvil simple con peso para muestras recientes
      this.metrics.averageResponseTime = (this.metrics.averageResponseTime * 0.8) + (newResponseTime * 0.2);
    }
  }

  /**
   * Imprime métricas detalladas en los logs
   */
  logPerformanceMetrics(): void {
    const metrics = this.getPerformanceMetrics();
    
    this.logger.log('📊 === RATE LIMITER PERFORMANCE METRICS ===');
    this.logger.log(`📈 Total Requests: ${metrics.totalRequests}`);
    this.logger.log(`✅ Success Rate: ${metrics.successRate}%`);
    this.logger.log(`❌ Failure Rate: ${metrics.failureRate}%`);
    this.logger.log(`🔄 Retry Rate: ${metrics.retryRate}%`);
    this.logger.log(`⏱️ Avg Response Time: ${metrics.averageResponseTime}ms`);
    this.logger.log(`⏳ Avg Queue Wait: ${metrics.averageQueueWaitTime}ms`);
    this.logger.log(`📋 Current Queue Size: ${metrics.currentQueueSize}`);
    this.logger.log(`🚨 Circuit Breaker Activations: ${metrics.circuitBreakerActivations}`);
    this.logger.log(`📊 Rate Limit Hits: ${metrics.rateLimitHits}`);
    this.logger.log(`🔧 Priority Distribution: High=${metrics.requestsByPriority.high}, Normal=${metrics.requestsByPriority.normal}, Low=${metrics.requestsByPriority.low}`);
    this.logger.log(`⏰ Service Uptime: ${metrics.uptime}`);
    this.logger.log('📊 ==========================================');
  }

  /**
   * Resetea el circuit breaker manualmente
   */
  resetCircuitBreaker(): void {
    this.circuitBreakerOpen = false;
    this.consecutiveFailures = 0;
    this.logger.log('🔄 Circuit breaker manually reset');
  }

  /**
   * Ajusta la configuración dinámicamente
   */
  updateConfig(partialConfig: Partial<RateLimitConfig>): void {
    Object.assign(this.config, partialConfig);
    this.logger.log(`⚙️ Rate limiter config updated:`, this.config);
  }
}