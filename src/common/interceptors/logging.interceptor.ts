import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, finalize } from 'rxjs/operators';
import { Request, Response } from 'express';
import { FileLoggerService } from '../services/file-logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(
    @Optional() @Inject(FileLoggerService) private readonly fileLoggerService?: FileLoggerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, url, ip } = request;
    const userAgent = request.get('User-Agent') || 'Unknown';

    // Intentar extraer record_id y document_name (headers y query siempre disponibles, body puede no estarlo)
    let recordId = this.extractRecordId(request);
    let documentName = this.extractDocumentName(request);

    // Iniciar captura de logs si tenemos record_id y fileLoggerService
    if (recordId && this.fileLoggerService) {
      this.fileLoggerService.startCapture(recordId, documentName);
      const docInfo = documentName ? ` (${documentName})` : '';
      this.logger.log(`📝 Iniciando captura de logs para record_id: ${recordId}${docInfo}`);
    }

    // Log de request entrante
    this.logger.log(
      `→ ${method} ${url} - IP: ${ip} - User-Agent: ${userAgent}`
    );

    // Log de archivos si existen (múltiples archivos)
    if (request.files) {
      const files = request.files as Express.Multer.File[];
      this.logger.log(`📁 Archivos recibidos: ${files.length} documentos`);
      files.forEach((file, index) => {
        this.logger.log(`   ${index + 1}. ${file.originalname} (${file.size} bytes)`);
      });
    }

    return next.handle().pipe(
      tap({
        next: (data) => {
          // Reintentar extraer record_id y document_name si no se encontraron antes (después de que Multer procese)
          if (!recordId) {
            recordId = this.extractRecordId(request);
            documentName = this.extractDocumentName(request);

            // Iniciar captura de logs si ahora encontramos record_id
            if (recordId && this.fileLoggerService && !this.fileLoggerService.isCapturing()) {
              this.fileLoggerService.startCapture(recordId, documentName);
              const docInfo = documentName ? ` (${documentName})` : '';
              this.logger.log(`📝 Iniciando captura de logs para record_id: ${recordId}${docInfo}`);
            }
          }

          const endTime = Date.now();
          const duration = endTime - startTime;
          const statusCode = response.statusCode;

          // Log de response exitosa
          this.logger.log(
            `← ${method} ${url} ${statusCode} - ${duration}ms`
          );

          // Log adicional para endpoint principal de underwriting
          if (url.includes('evaluate-claim') && data?.claim_reference) {
            const status = data.success ? '✅ Éxito' : '❌ Error';
            this.logger.log(
              `🔍 Evaluación de claim: ${status} - ${data.claim_reference} en ${duration}ms`
            );
          }
        },
        error: (error) => {
          const endTime = Date.now();
          const duration = endTime - startTime;
          const statusCode = error.status || 500;

          // Log de error
          this.logger.error(
            `← ${method} ${url} ${statusCode} - ${duration}ms - Error: ${error.message}`
          );
        },
      }),
      finalize(async () => {
        // Finalizar captura de logs cuando termine el request (éxito o error)
        if (recordId && this.fileLoggerService && this.fileLoggerService.isCapturing()) {
          const endTime = Date.now();
          const duration = endTime - startTime;

          this.logger.log(`📝 Finalizando captura de logs (${duration}ms)`);

          try {
            const filename = await this.fileLoggerService.finishCapture();
            if (filename) {
              this.logger.log(`💾 Logs guardados en: ${filename}`);
            }
          } catch (error) {
            this.logger.error(`❌ Error guardando logs: ${error.message}`);
          }
        }
      }),
    );
  }

  /**
   * Extrae el record_id del request
   * Intenta múltiples fuentes en orden de prioridad
   * @param request - Request de Express
   * @returns record_id o null si no existe
   */
  private extractRecordId(request: Request): string | null {
    try {
      // PRIORIDAD 1: Header (siempre disponible inmediatamente)
      const headerRecordId = request.get('x-record-id') || request.get('record-id');
      if (headerRecordId) {
        return String(headerRecordId);
      }

      // PRIORIDAD 2: Query params (siempre disponible inmediatamente)
      if (request.query && request.query.record_id) {
        return String(request.query.record_id);
      }

      // PRIORIDAD 3: Request body (puede no estar disponible si es multipart/form-data)
      if (request.body && request.body.record_id) {
        return String(request.body.record_id);
      }

      // PRIORIDAD 4: Form-data fields (después de que Multer procese)
      if ((request as any).fields && (request as any).fields.record_id) {
        return String((request as any).fields.record_id);
      }

      return null;
    } catch (error) {
      this.logger.warn(`⚠️ Error extrayendo record_id: ${error.message}`);
      return null;
    }
  }

  /**
   * Extrae el document_name del request
   * Intenta múltiples fuentes en orden de prioridad
   * @param request - Request de Express
   * @returns document_name o null si no existe
   */
  private extractDocumentName(request: Request): string | null {
    try {
      // PRIORIDAD 1: Header (siempre disponible inmediatamente)
      const headerDocName = request.get('x-document-name') || request.get('document-name');
      if (headerDocName) {
        return String(headerDocName);
      }

      // PRIORIDAD 2: Query params (siempre disponible inmediatamente)
      if (request.query && request.query.document_name) {
        return String(request.query.document_name);
      }

      // PRIORIDAD 3: Request body (puede no estar disponible si es multipart/form-data)
      if (request.body && request.body.document_name) {
        return String(request.body.document_name);
      }

      // PRIORIDAD 4: Form-data fields (después de que Multer procese)
      if ((request as any).fields && (request as any).fields.document_name) {
        return String((request as any).fields.document_name);
      }

      return null;
    } catch (error) {
      this.logger.warn(`⚠️ Error extrayendo document_name: ${error.message}`);
      return null;
    }
  }
}