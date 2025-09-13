import { NestFactory } from '@nestjs/core';
import { ValidationPipe, LogLevel } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { EnvValidation } from './config/env-validation';

async function bootstrap() {
  // Validar variables de entorno al iniciar
  EnvValidation.validate();
  
  // Configurar nivel de logging basado en LOG_LEVEL
  const getLogLevels = (): LogLevel[] => {
    const level = process.env.LOG_LEVEL?.toLowerCase() || 'log';
    switch (level) {
      case 'error': return ['error'];
      case 'warn': return ['error', 'warn'];
      case 'log': return ['error', 'warn', 'log'];
      case 'debug': return ['error', 'warn', 'log', 'debug', 'verbose'];
      case 'verbose': return ['error', 'warn', 'log', 'debug', 'verbose'];
      default: return ['error', 'warn', 'log'];
    }
  };

  const app = await NestFactory.create(AppModule, {
    // Aumentar timeout a 8 minutos (480 segundos)
    rawBody: true,
    logger: getLogLevels(),
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

  // Setup Swagger
  const config = new DocumentBuilder()
    .setTitle('UWIA API')
    .setDescription('The UWIA API for intelligent underwriting.')
    .setVersion('1.0')
    .addTag('uwia')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = parseInt(process.env.PORT) || 5011; // Puerto por defecto 5011 para uwia
  await app.listen(port, '0.0.0.0'); // Escuchar en todas las interfaces para permitir conexiones desde otros contenedores
  
  console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
  console.log(`🎯 DEPLOY VERIFICADO - ${new Date().toISOString()}`);
  console.log(`✅ Escuchando en TODAS las interfaces: 0.0.0.0:${port}`);
  console.log(`🔥 Puerto configurado: ${port} (desde ENV: ${process.env.PORT})`);
  console.log(`🌐 Accesible desde: http://automate_uwia_qa:${port}/api`);
  console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
  console.log(`🚀 UWIA - Underwriting IA iniciado en: http://0.0.0.0:${port}/api`);
  console.log(`📚 Swagger Docs: http://0.0.0.0:${port}/api/docs`);
  console.log(`📋 Health check: http://0.0.0.0:${port}/api/health`);
  console.log(`🔍 Evaluate claim: POST http://0.0.0.0:${port}/api/underwriting/evaluate-claim`);
  console.log('🔧 Build version: 09-05-25-NETWORK-FIX (Docker ports dynamic)');
}

bootstrap();