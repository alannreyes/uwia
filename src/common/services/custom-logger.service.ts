import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { FileLoggerService } from './file-logger.service';

/**
 * CustomLoggerService - Logger personalizado que captura logs a archivo
 *
 * Extiende el comportamiento del Logger de NestJS para:
 * - Mantener la salida a consola (comportamiento normal)
 * - Capturar logs en archivos cuando hay un contexto activo
 * - Ser completamente transparente para el código existente
 */
@Injectable({ scope: Scope.TRANSIENT })
export class CustomLoggerService extends Logger {
  constructor(
    context?: string,
    private readonly fileLoggerService?: FileLoggerService,
  ) {
    super(context);
  }

  /**
   * Log normal
   */
  log(message: any, context?: string): void {
    super.log(message, context);
    this.captureToFile('LOG', message, context);
  }

  /**
   * Log de error
   */
  error(message: any, trace?: string, context?: string): void {
    super.error(message, trace, context);
    this.captureToFile('ERROR', message, context, trace);
  }

  /**
   * Log de advertencia
   */
  warn(message: any, context?: string): void {
    super.warn(message, context);
    this.captureToFile('WARN', message, context);
  }

  /**
   * Log de debug
   */
  debug(message: any, context?: string): void {
    super.debug(message, context);
    this.captureToFile('DEBUG', message, context);
  }

  /**
   * Log verbose
   */
  verbose(message: any, context?: string): void {
    super.verbose(message, context);
    this.captureToFile('VERBOSE', message, context);
  }

  /**
   * Captura el log al archivo si hay un contexto activo
   */
  private captureToFile(
    level: string,
    message: any,
    context?: string,
    trace?: string,
  ): void {
    if (!this.fileLoggerService || !this.fileLoggerService.isCapturing()) {
      return;
    }

    try {
      const contextStr = context || this.context || '';
      const messageStr = typeof message === 'object' ? JSON.stringify(message) : String(message);
      const traceStr = trace ? ` | Trace: ${trace}` : '';

      const logLine = `[${level}]${contextStr ? `[${contextStr}]` : ''} ${messageStr}${traceStr}`;

      this.fileLoggerService.captureLog(logLine);
    } catch (error) {
      // Silenciosamente falla si hay error en captura (no interrumpir flujo normal)
    }
  }
}
