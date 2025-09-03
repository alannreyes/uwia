import { Logger } from '@nestjs/common';

/**
 * ProductionLogger - Helper para logging limpio en producción
 * Controla la verbosidad basado en variables de entorno
 */
export class ProductionLogger {
  private readonly logger: Logger;
  
  constructor(context: string) {
    this.logger = new Logger(context);
  }

  /**
   * SIEMPRE se muestran - Logs críticos para producción
   */

  documentStart(filename: string, sizeMB: number, provider: string, fieldCount: number) {
    if (this.isEnabled('ENABLE_DOCUMENT_START_END_LOGS')) {
      this.logger.log(`🚀 [INICIO] Processing ${filename} (${sizeMB.toFixed(2)}MB) | Provider: ${provider} | Fields: ${fieldCount}`);
    }
  }

  documentEnd(filename: string, duration: number, success: number, total: number, errors: number, warnings: number) {
    if (this.isEnabled('ENABLE_DOCUMENT_START_END_LOGS')) {
      this.logger.log(`✅ [COMPLETADO] ${filename} | Duration: ${duration.toFixed(1)}s | Success: ${success}/${total} | Errors: ${errors} | Warnings: ${warnings}`);
    }
  }

  error(filename: string, field: string, service: string, error: string) {
    if (this.isEnabled('ENABLE_ERROR_LOGS')) {
      this.logger.error(`❌ [ERROR] ${filename} | Field: ${field} | Service: ${service} | Error: ${error}`);
    }
  }

  warning(filename: string, field: string, message: string) {
    if (this.isEnabled('ENABLE_WARNING_LOGS')) {
      this.logger.warn(`⚠️ [WARNING] ${filename} | Field: ${field} | ${message}`);
    }
  }

  performance(filename: string, operation: string, duration: number, details?: string) {
    if (this.isEnabled('ENABLE_PERFORMANCE_LOGS')) {
      const detailsStr = details ? ` | ${details}` : '';
      this.logger.log(`📊 [PERFORMANCE] ${filename} | ${operation}: ${duration.toFixed(1)}s${detailsStr}`);
    }
  }

  /**
   * CONDICIONALES - Solo en desarrollo o cuando se habiliten explícitamente
   */

  fieldSuccess(filename: string, field: string, result: string, confidence?: number) {
    if (this.isEnabled('ENABLE_FIELD_SUCCESS_LOGS')) {
      const confidenceStr = confidence ? ` (confidence: ${confidence.toFixed(2)})` : '';
      this.logger.log(`✅ [SUCCESS] ${filename} | Field: ${field} | Result: ${result}${confidenceStr}`);
    }
  }

  strategyDebug(filename: string, field: string, message: string) {
    if (this.isEnabled('ENABLE_STRATEGY_DEBUG_LOGS')) {
      this.logger.debug(`🔍 [STRATEGY] ${filename} | Field: ${field} | ${message}`);
    }
  }

  conversionLog(filename: string, message: string) {
    if (this.isEnabled('ENABLE_CONVERSION_LOGS')) {
      this.logger.log(`🖼️ [CONVERSION] ${filename} | ${message}`);
    }
  }

  visionApiLog(filename: string, field: string, page: number, model: string, result?: string) {
    if (this.isEnabled('ENABLE_VISION_API_LOGS')) {
      const resultStr = result ? ` | Result: ${result}` : '';
      this.logger.log(`🎯 [VISION] ${filename} | Field: ${field} | Page: ${page} | Model: ${model}${resultStr}`);
    }
  }

  debug(filename: string, field: string, message: string) {
    if (this.isEnabled('ENABLE_STRATEGY_DEBUG_LOGS')) {
      this.logger.debug(`🔧 [DEBUG] ${filename} | Field: ${field} | ${message}`);
    }
  }

  /**
   * Helpers para logging condicional basado en contexto
   */

  // Para logs de LOP específicos
  lopDebug(filename: string, field: string, message: string) {
    // Solo mostrar logs LOP debug si hay problemas o está habilitado
    if (this.isEnabled('ENABLE_STRATEGY_DEBUG_LOGS') || filename.toUpperCase().includes('LOP')) {
      this.logger.debug(`🔍 [LOP] ${filename} | Field: ${field} | ${message}`);
    }
  }

  // Para logs de rate limiting y circuit breaker (siempre importantes)
  rateLimitWarning(filename: string, field: string, service: string, retryAfter?: number) {
    const retryStr = retryAfter ? ` | Retry after: ${retryAfter}s` : '';
    this.logger.warn(`🚫 [RATE_LIMIT] ${filename} | Field: ${field} | Service: ${service}${retryStr}`);
  }

  circuitBreakerWarning(filename: string, field: string, service: string, state: string) {
    this.logger.warn(`⚡ [CIRCUIT_BREAKER] ${filename} | Field: ${field} | Service: ${service} | State: ${state}`);
  }

  /**
   * Utility para verificar si un tipo de log está habilitado
   */
  private isEnabled(envVar: string): boolean {
    return process.env[envVar] === 'true';
  }

  /**
   * Para retrocompatibilidad - envuelve el logger original
   */
  log(message: string) {
    this.logger.log(message);
  }

  warn(message: string) {
    this.logger.warn(message);
  }

  logError(message: string) {
    this.logger.error(message);
  }

  /**
   * Helper para crear contadores de resumen
   */
  createSummary() {
    return {
      successCount: 0,
      errorCount: 0,
      warningCount: 0,
      startTime: Date.now(),
      
      addSuccess() { this.successCount++; },
      addError() { this.errorCount++; },
      addWarning() { this.warningCount++; },
      
      getDuration() { 
        return (Date.now() - this.startTime) / 1000; 
      }
    };
  }
}