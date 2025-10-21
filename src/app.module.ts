import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { UnderwritingModule } from './modules/underwriting/underwriting.module';
import { ChunkingModule } from './modules/underwriting/chunking/chunking.module';
import { databaseConfig } from './config/database.config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { FileLoggerService } from './common/services/file-logger.service';
import { LogCleanupService } from './common/services/log-cleanup.service';
import { GlobalFileLoggerService } from './common/services/global-file-logger.service';

@Module({
  imports: [
    // Configuración de variables de entorno
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Módulo de tareas programadas (cron jobs)
    ScheduleModule.forRoot(),

    // Configuración de base de datos MySQL
    TypeOrmModule.forRootAsync({
      useFactory: databaseConfig,
    }),

    // Configuración global de Multer para archivos
    MulterModule.register({
      limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800, // 50MB por defecto
      },
      fileFilter: (req, file, callback) => {
        // Validar que solo se procesen PDFs
        if (file.mimetype === 'application/pdf') {
          callback(null, true);
        } else {
          callback(new Error('Solo se permiten archivos PDF'), false);
        }
      },
    }),

    // Módulo principal de underwriting
    UnderwritingModule,

    // Módulo para procesamiento de chunks
    ChunkingModule,
  ],
  controllers: [],
  providers: [
    // Servicios de logging persistente
    FileLoggerService,
    LogCleanupService,
    GlobalFileLoggerService,

    // Filtro global de excepciones
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Interceptor global de logging
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}