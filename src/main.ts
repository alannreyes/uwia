import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { EnvValidation } from './config/env-validation';

async function bootstrap() {
  // Validar variables de entorno al iniciar
  EnvValidation.validate();
  const app = await NestFactory.create(AppModule, {
    // Aumentar timeout a 8 minutos (480 segundos)
    rawBody: true,
  });
  
  // Configurar timeout del servidor a 8 minutos
  const server = app.getHttpServer();
  server.setTimeout(8 * 60 * 1000); // 8 minutos en milisegundos
  server.headersTimeout = 8 * 60 * 1000 + 1000; // Un poco más que el timeout regular
  server.keepAliveTimeout = 8 * 60 * 1000;
  
  // Configurar validación global
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Configurar CORS de forma segura
  app.enableCors({
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://yourdomain.com'] // Cambiar por dominio real en producción
      : true, // Permitir cualquier origen en desarrollo
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Configurar prefijo global para API
  app.setGlobalPrefix('api');

  const port = parseInt(process.env.PORT) || 5011; // Puerto por defecto 5011 para uwia
  await app.listen(port);
  
  console.log(`🚀 UWIA - Underwriting IA iniciado en: http://localhost:${port}/api`);
  console.log(`📋 Health check: http://localhost:${port}/api/health`);
  console.log(`🔍 Evaluate claim: POST http://localhost:${port}/api/underwriting/evaluate-claim`);
  console.log('🔧 Build version: 08-13-25-v2 (with pdfjs-dist diagnostics)');
}

bootstrap();