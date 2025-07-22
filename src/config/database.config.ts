import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { UwClaim } from '../modules/underwriting/entities/uw-claim.entity';
import { UwDocument } from '../modules/underwriting/entities/uw-document.entity';
import { UwEvaluation } from '../modules/underwriting/entities/uw-evaluation.entity';

export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'mysql',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || process.env.DB_NAME,
  entities: [UwClaim, UwDocument, UwEvaluation],
  synchronize: false, // NUNCA sincronizar automáticamente en producción
  logging: process.env.NODE_ENV === 'development',
  autoLoadEntities: true,
  retryAttempts: 3,
  retryDelay: 3000,
});