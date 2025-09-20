import { Logger } from '@nestjs/common';

export class EnvValidation {
  private static readonly logger = new Logger('EnvValidation');

  static validate(): void {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validar variables requeridas
    if (!process.env.OPENAI_API_KEY) {
      errors.push('OPENAI_API_KEY es requerida');
    } else if (!process.env.OPENAI_API_KEY.startsWith('sk-')) {
      warnings.push('OPENAI_API_KEY no parece ser válida (debería empezar con sk-)');
    }

    // Validar configuración de base de datos (solo si no hay DATABASE_URL)
    if (!process.env.DATABASE_URL) {
      if (!process.env.DB_HOST) {
        errors.push('DB_HOST es requerida (o proporciona DATABASE_URL)');
      }
      if (!process.env.DB_USERNAME) {
        errors.push('DB_USERNAME es requerida (o proporciona DATABASE_URL)');
      }
      if (!process.env.DB_PASSWORD) {
        errors.push('DB_PASSWORD es requerida (o proporciona DATABASE_URL)');
      }
      if (!process.env.DB_DATABASE && !process.env.DB_NAME) {
        errors.push('DB_DATABASE o DB_NAME es requerida (o proporciona DATABASE_URL)');
      }
    }

    // Validar modelo OpenAI
    const model = process.env.OPENAI_MODEL;
    if (model && model.includes(' ')) {
      warnings.push(`OPENAI_MODEL contiene espacios: "${model}". Se convertirá a: "${model.replace(/\s+/g, '-')}"`);
    }

    // Validar puerto
    const port = process.env.PORT;
    if (port && isNaN(parseInt(port))) {
      errors.push(`PORT debe ser un número válido, recibido: ${port}`);
    }

    // Validar tamaño máximo de archivo
    const maxFileSize = process.env.MAX_FILE_SIZE;
    if (maxFileSize && isNaN(parseInt(maxFileSize))) {
      errors.push(`MAX_FILE_SIZE debe ser un número válido, recibido: ${maxFileSize}`);
    }

    // Validar NODE_ENV
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv && !['development', 'production', 'test'].includes(nodeEnv)) {
      warnings.push(`NODE_ENV tiene valor no estándar: ${nodeEnv}`);
    }

    // Reportar errores y warnings
    if (warnings.length > 0) {
      this.logger.warn('⚠️  Advertencias de configuración:');
      warnings.forEach(warning => this.logger.warn(`   - ${warning}`));
    }

    if (errors.length > 0) {
      this.logger.error('❌ Errores de configuración:');
      errors.forEach(error => this.logger.error(`   - ${error}`));
      throw new Error(`Configuración inválida: ${errors.join(', ')}`);
    }

    this.logger.log('✅ Configuración de variables de entorno validada exitosamente');
    
    // Log de configuración actual (sin datos sensibles)
    this.logger.log(`📊 Configuración actual:`);
    this.logger.log(`   - Puerto: ${process.env.PORT || 5011}`);
    this.logger.log(`   - Entorno: ${process.env.NODE_ENV || 'development'}`);
    this.logger.log(`   - DB Host: ${process.env.DB_HOST}`);
    this.logger.log(`   - DB Name: ${process.env.DB_DATABASE || process.env.DB_NAME}`);
    this.logger.log(`   - OpenAI Model: ${(process.env.OPENAI_MODEL || 'gpt-4o').replace(/\s+/g, '-')}`);
    const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 10485760;
    const maxFileSizeMB = (maxFileSize / 1048576).toFixed(2);
    this.logger.log(`   - Max File Size: ${maxFileSize} bytes (${maxFileSizeMB}MB) from MAX_FILE_SIZE`);
  }
}