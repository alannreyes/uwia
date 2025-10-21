import { Injectable, LoggerService, ConsoleLogger } from '@nestjs/common';
import { FileLoggerService } from './file-logger.service';

/**
 * GlobalFileLoggerService - Logger global que captura a consola Y archivo
 *
 * Reemplaza el Logger por defecto de NestJS para:
 * - Mantener TODA la salida a consola (comportamiento normal)
 * - Capturar logs en archivos cuando FileLoggerService tiene contexto activo
 * - Ser completamente transparente para todo el código existente
 *
 * Este logger se instala globalmente en main.ts:
 * app.useLogger(app.get(GlobalFileLoggerService));
 */
@Injectable()
export class GlobalFileLoggerService extends ConsoleLogger implements LoggerService {
  constructor(private readonly fileLoggerService: FileLoggerService) {
    super();
    // Usar 'UWIA' como contexto por defecto
    this.setContext('UWIA');
  }

  /**
   * Override log - Captura logs normales
   */
  log(message: any, context?: string): void {
    // Primero, hacer el log normal a consola
    super.log(message, context);

    // Luego, capturar al archivo si hay contexto activo
    this.captureToFile('LOG', message, context);
  }

  /**
   * Override error - Captura errores
   */
  error(message: any, stack?: string, context?: string): void {
    // Log normal a consola
    super.error(message, stack, context);

    // Capturar al archivo
    const fullMessage = stack ? `${message}\n${stack}` : message;
    this.captureToFile('ERROR', fullMessage, context);
  }

  /**
   * Override warn - Captura advertencias
   */
  warn(message: any, context?: string): void {
    // Log normal a consola
    super.warn(message, context);

    // Capturar al archivo
    this.captureToFile('WARN', message, context);
  }

  /**
   * Override debug - Captura debug logs
   */
  debug(message: any, context?: string): void {
    // Log normal a consola
    super.debug(message, context);

    // Capturar al archivo
    this.captureToFile('DEBUG', message, context);
  }

  /**
   * Override verbose - Captura logs verbosos
   */
  verbose(message: any, context?: string): void {
    // Log normal a consola
    super.verbose(message, context);

    // Capturar al archivo
    this.captureToFile('VERBOSE', message, context);
  }

  /**
   * Captura el log al archivo si hay un contexto activo
   * @private
   */
  private captureToFile(level: string, message: any, context?: string): void {
    // Solo capturar si FileLoggerService está activamente capturando
    if (!this.fileLoggerService.isCapturing()) {
      return;
    }

    try {
      // Convertir mensaje a string si es necesario
      const messageStr = typeof message === 'object' ? JSON.stringify(message) : String(message);

      // Formatear con contexto si existe
      const contextStr = context ? `[${context}]` : '';
      const logLine = `[${level}]${contextStr} ${messageStr}`;

      // Enviar al file logger
      this.fileLoggerService.captureLog(logLine);
    } catch (error) {
      // Silenciosamente ignorar errores de captura (no interrumpir flujo normal)
      // Solo mostrar en consola si es crítico
      if (error.message && !error.message.includes('ENOENT')) {
        super.error(`Failed to capture log to file: ${error.message}`);
      }
    }
  }
}
