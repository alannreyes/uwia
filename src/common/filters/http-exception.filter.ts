import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let errorResponse: any;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exception.message;
        errorResponse = exceptionResponse;
      } else {
        message = exception.message;
      }
    } else {
      // Error no controlado
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      this.logger.error('Error no controlado:', exception);
    }

    // Log del error
    const errorLog = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: message,
      userAgent: request.get('User-Agent') || 'Unknown',
      ip: request.ip,
    };

    if (status >= 500) {
      this.logger.error('Error del servidor:', errorLog);
    } else if (status >= 400) {
      this.logger.warn('Error del cliente:', errorLog);
    }

    // Respuesta al cliente
    const clientResponse = errorResponse || {
      success: false,
      error: message,
      statusCode: status,
      timestamp: errorLog.timestamp,
      path: request.url,
    };

    response.status(status).json(clientResponse);
  }
}