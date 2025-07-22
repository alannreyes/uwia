import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { UnderwritingModule } from './modules/underwriting/underwriting.module';
import { databaseConfig } from './config/database.config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    // Configuración de variables de entorno
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    
    // Configuración de base de datos MySQL
    TypeOrmModule.forRootAsync({
      useFactory: databaseConfig,
    }),
    
    // Configuración global de Multer para archivos
    MulterModule.register({
      limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB
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
  ],
  controllers: [],
  providers: [
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