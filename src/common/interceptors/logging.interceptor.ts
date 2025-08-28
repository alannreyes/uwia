import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, url, ip } = request;
    const userAgent = request.get('User-Agent') || 'Unknown';

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
    );
  }
}