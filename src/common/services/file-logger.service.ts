import { Injectable, Logger, Scope } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface para el contexto de logs de cada request
 */
interface LogContext {
  recordId: string;
  documentName?: string;
  timestamp: string;
  logs: string[];
}

/**
 * FileLoggerService - Servicio para captura y persistencia de logs
 *
 * Características:
 * - Captura todos los logs durante la ejecución de un request
 * - Mantiene la salida a consola (comportamiento normal)
 * - Escribe logs a archivos con formato aammddhhmm_recordid.log
 * - Thread-safe usando AsyncLocalStorage
 */
@Injectable({ scope: Scope.DEFAULT })
export class FileLoggerService {
  private readonly asyncLocalStorage = new AsyncLocalStorage<LogContext>();
  private readonly logsDirectory = '/app/logs';
  private readonly baseLogger = new Logger('FileLoggerService');

  constructor() {
    this.ensureLogsDirectory();
  }

  /**
   * Asegura que el directorio de logs existe
   */
  private ensureLogsDirectory(): void {
    if (!fs.existsSync(this.logsDirectory)) {
      fs.mkdirSync(this.logsDirectory, { recursive: true });
      this.baseLogger.log(`📁 Directorio de logs creado: ${this.logsDirectory}`);
    }
  }

  /**
   * Inicia la captura de logs para un request específico
   * @param recordId - ID del record a procesar
   * @param documentName - Nombre del documento (opcional, para incluir en nombre de archivo)
   */
  startCapture(recordId: string, documentName?: string): void {
    const now = new Date();

    // Formato: aammddhhmm (año 2 dígitos, mes, día, hora, minuto)
    const timestamp = [
      String(now.getFullYear()).slice(-2).padStart(2, '0'),  // aa
      String(now.getMonth() + 1).padStart(2, '0'),           // mm
      String(now.getDate()).padStart(2, '0'),                // dd
      String(now.getHours()).padStart(2, '0'),               // hh
      String(now.getMinutes()).padStart(2, '0'),             // mm
    ].join('');

    const context: LogContext = {
      recordId,
      documentName,
      timestamp,
      logs: [],
    };

    this.asyncLocalStorage.enterWith(context);

    // Log inicial (también va al archivo)
    const docInfo = documentName ? ` | Document: ${documentName}` : '';
    this.captureLog(`📝 [INICIO CAPTURA] Record ID: ${recordId}${docInfo} | Timestamp: ${timestamp}`);
  }

  /**
   * Captura un mensaje de log
   * @param message - Mensaje a capturar
   */
  captureLog(message: string): void {
    const context = this.asyncLocalStorage.getStore();
    if (context) {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}`;
      context.logs.push(logEntry);
    }
  }

  /**
   * Finaliza la captura y escribe el archivo de log
   * @returns El nombre del archivo creado o null si no había contexto
   */
  async finishCapture(): Promise<string | null> {
    const context = this.asyncLocalStorage.getStore();

    if (!context) {
      this.baseLogger.warn('⚠️ finishCapture llamado sin contexto activo');
      return null;
    }

    const { recordId, documentName, timestamp, logs } = context;

    // Formato del nombre: aammddhhmm_recordid_DOCUMENTNAME.log
    // Si no hay documentName, usar formato anterior: aammddhhmm_recordid.log
    const docSuffix = documentName ? `_${documentName}` : '';
    const filename = `${timestamp}_${recordId}${docSuffix}.log`;
    const filepath = path.join(this.logsDirectory, filename);

    try {
      // Log final
      this.captureLog(`📝 [FIN CAPTURA] Total logs capturados: ${logs.length}`);

      // Escribir todos los logs al archivo
      const logContent = logs.join('\n') + '\n';
      await fs.promises.writeFile(filepath, logContent, 'utf8');

      this.baseLogger.log(`✅ Logs escritos: ${filepath} (${logs.length} líneas)`);

      return filename;
    } catch (error) {
      this.baseLogger.error(`❌ Error escribiendo logs a ${filepath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Verifica si hay una captura activa
   * @returns true si hay un contexto activo
   */
  isCapturing(): boolean {
    return this.asyncLocalStorage.getStore() !== undefined;
  }

  /**
   * Obtiene información del contexto actual
   * @returns Información del contexto o null
   */
  getContextInfo(): { recordId: string; documentName?: string; timestamp: string; logCount: number } | null {
    const context = this.asyncLocalStorage.getStore();
    if (!context) {
      return null;
    }

    return {
      recordId: context.recordId,
      documentName: context.documentName,
      timestamp: context.timestamp,
      logCount: context.logs.length,
    };
  }
}
