import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';

/**
 * LogCleanupService - Servicio para rotación automática de logs
 *
 * Características:
 * - Ejecuta diariamente a las 2:00 AM
 * - Elimina logs más antiguos de 3 meses (90 días)
 * - Mantiene logs recientes para auditoría
 * - Reporta estadísticas de limpieza
 */
@Injectable()
export class LogCleanupService {
  private readonly logger = new Logger('LogCleanupService');
  private readonly logsDirectory = '/app/logs';
  private readonly retentionDays = 90; // 3 meses

  /**
   * Cron job que ejecuta la limpieza diariamente a las 2:00 AM
   * Formato: segundo minuto hora día mes día-semana
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleCron() {
    this.logger.log('🧹 Iniciando limpieza automática de logs...');
    await this.cleanupOldLogs();
  }

  /**
   * Limpia logs antiguos (> 90 días)
   * @returns Estadísticas de limpieza
   */
  async cleanupOldLogs(): Promise<{
    deleted: number;
    kept: number;
    freedMB: number;
    errors: number;
  }> {
    const stats = {
      deleted: 0,
      kept: 0,
      freedMB: 0,
      errors: 0,
    };

    try {
      // Verificar que el directorio existe
      if (!fs.existsSync(this.logsDirectory)) {
        this.logger.warn(`⚠️ Directorio de logs no existe: ${this.logsDirectory}`);
        return stats;
      }

      // Leer todos los archivos .log
      const files = await fs.promises.readdir(this.logsDirectory);
      const logFiles = files.filter((file) => file.endsWith('.log'));

      this.logger.log(`📂 Encontrados ${logFiles.length} archivos de log`);

      // Calcular fecha límite (hace 90 días)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      const cutoffTimestamp = cutoffDate.getTime();

      // Procesar cada archivo
      for (const filename of logFiles) {
        const filepath = path.join(this.logsDirectory, filename);

        try {
          // Obtener fecha de modificación del archivo
          const fileStat = await fs.promises.stat(filepath);
          const fileTimestamp = fileStat.mtimeMs;

          // Si el archivo es más antiguo que el límite, eliminarlo
          if (fileTimestamp < cutoffTimestamp) {
            const fileSizeMB = fileStat.size / (1024 * 1024);

            await fs.promises.unlink(filepath);

            stats.deleted++;
            stats.freedMB += fileSizeMB;

            this.logger.debug(`🗑️ Eliminado: ${filename} (${fileSizeMB.toFixed(2)}MB)`);
          } else {
            stats.kept++;
          }
        } catch (error) {
          stats.errors++;
          this.logger.error(`❌ Error procesando ${filename}: ${error.message}`);
        }
      }

      // Reporte final
      this.logger.log(
        `✅ Limpieza completada | ` +
          `Eliminados: ${stats.deleted} | ` +
          `Mantenidos: ${stats.kept} | ` +
          `Espacio liberado: ${stats.freedMB.toFixed(2)}MB | ` +
          `Errores: ${stats.errors}`,
      );

      return stats;
    } catch (error) {
      this.logger.error(`❌ Error en limpieza de logs: ${error.message}`);
      return stats;
    }
  }

  /**
   * Fuerza una limpieza manual (útil para testing)
   */
  async forceCleanup(): Promise<void> {
    this.logger.log('🔧 Limpieza manual iniciada');
    await this.cleanupOldLogs();
  }

  /**
   * Obtiene estadísticas del directorio de logs
   */
  async getLogsStats(): Promise<{
    totalFiles: number;
    totalSizeMB: number;
    oldestFile: string | null;
    newestFile: string | null;
  }> {
    const stats = {
      totalFiles: 0,
      totalSizeMB: 0,
      oldestFile: null as string | null,
      newestFile: null as string | null,
    };

    try {
      if (!fs.existsSync(this.logsDirectory)) {
        return stats;
      }

      const files = await fs.promises.readdir(this.logsDirectory);
      const logFiles = files.filter((file) => file.endsWith('.log'));

      stats.totalFiles = logFiles.length;

      let oldestTime = Infinity;
      let newestTime = 0;

      for (const filename of logFiles) {
        const filepath = path.join(this.logsDirectory, filename);
        const fileStat = await fs.promises.stat(filepath);

        stats.totalSizeMB += fileStat.size / (1024 * 1024);

        if (fileStat.mtimeMs < oldestTime) {
          oldestTime = fileStat.mtimeMs;
          stats.oldestFile = filename;
        }

        if (fileStat.mtimeMs > newestTime) {
          newestTime = fileStat.mtimeMs;
          stats.newestFile = filename;
        }
      }

      return stats;
    } catch (error) {
      this.logger.error(`❌ Error obteniendo estadísticas: ${error.message}`);
      return stats;
    }
  }
}
