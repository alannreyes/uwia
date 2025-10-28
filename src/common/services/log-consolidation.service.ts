import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

/**
 * LogConsolidationService - Servicio para consolidar logs de múltiples documentos
 *
 * Funcionalidad:
 * - Busca archivos de log con timestamp flexible (±5 minutos)
 * - Consulta documentos activos de MySQL
 * - Reintentos inteligentes (10s inicial + 2x30s)
 * - Consolida todos los logs en un archivo _ALL.log
 */
@Injectable()
export class LogConsolidationService {
  private readonly logger = new Logger(LogConsolidationService.name);
  private readonly logsDirectory = '/app/logs';

  constructor(
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Obtener nombres de documentos activos de la base de datos
   * @returns Array de nombres de documentos sin extensión (ej: ['LOP', 'POLICY', ...])
   */
  async getActiveDocuments(): Promise<string[]> {
    try {
      const result = await this.connection.query(
        'SELECT document_name FROM document_consolidado WHERE active = 1'
      );

      // Remover extensión .pdf y retornar en mayúsculas
      return result.map((row: any) =>
        row.document_name.replace('.pdf', '').toUpperCase()
      );
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos activos: ${error.message}`);
      // Fallback a documentos conocidos
      return ['LOP', 'POLICY', 'CERTIFICATE', 'WEATHER', 'ESTIMATE', 'MOLD', 'ROOF'];
    }
  }

  /**
   * Buscar archivos de log con timestamp flexible (±5 minutos)
   * @param recordId - ID del record
   * @param centralTimestamp - Timestamp central en formato aammddhhmm
   * @returns Array de nombres de archivos encontrados
   */
  async findLogFilesFlexible(
    recordId: string,
    centralTimestamp: string
  ): Promise<string[]> {
    try {
      const allFiles = await fs.promises.readdir(this.logsDirectory);

      // Convertir timestamp central a Date
      const central = this.parseTimestamp(centralTimestamp);

      // Filtrar archivos que coincidan con ±5 minutos
      const matchingFiles = allFiles.filter(filename => {
        // Patrón: aammddhhmm_recordid_DOCNAME.log
        const match = filename.match(/^(\d{10})_(\d+)_([A-Z]+)\.log$/);
        if (!match) return false;

        const [_, fileTimestamp, fileRecordId, docName] = match;

        // Verificar record_id
        if (fileRecordId !== recordId) return false;

        // Verificar timestamp ±5 minutos
        const fileDate = this.parseTimestamp(fileTimestamp);
        const diffMinutes = Math.abs(central.getTime() - fileDate.getTime()) / 60000;

        return diffMinutes <= 5;
      });

      return matchingFiles.sort(); // Orden alfabético
    } catch (error) {
      this.logger.error(`❌ Error buscando archivos: ${error.message}`);
      return [];
    }
  }

  /**
   * Consolidar logs con reintentos inteligentes
   * @param recordId - ID del record
   * @param timestamp - Timestamp en formato aammddhhmm
   * @param attempt - Número de intento actual
   */
  async consolidateWithRetry(
    recordId: string,
    timestamp: string,
    attempt: number = 1
  ): Promise<void> {
    const maxAttempts = 3;
    const retryDelay = attempt === 1 ? 10000 : 30000; // 10s inicial, 30s reintentos

    this.logger.log(`🔄 [CONSOLIDATE] Intento ${attempt}/${maxAttempts} para record ${recordId}`);

    // Obtener documentos activos esperados
    const expectedDocs = await this.getActiveDocuments();
    this.logger.log(`📋 [CONSOLIDATE] Documentos esperados (${expectedDocs.length}): ${expectedDocs.join(', ')}`);

    // Buscar archivos con timestamp flexible
    const foundFiles = await this.findLogFilesFlexible(recordId, timestamp);
    this.logger.log(`📁 [CONSOLIDATE] Archivos encontrados: ${foundFiles.length}/${expectedDocs.length}`);

    if (foundFiles.length === 0) {
      this.logger.error(`❌ [CONSOLIDATE] No se encontraron archivos para ${timestamp}_${recordId}`);
      return;
    }

    // Extraer nombres de documentos de los archivos encontrados
    const foundDocs = foundFiles.map(f => {
      const match = f.match(/_([A-Z]+)\.log$/);
      return match ? match[1] : null;
    }).filter(Boolean);

    this.logger.log(`📄 [CONSOLIDATE] Documentos encontrados: ${foundDocs.join(', ')}`);

    // Decidir si consolidar o reintentar
    const allDocsFound = expectedDocs.every(doc =>
      foundDocs.includes(doc)
    );

    if (allDocsFound) {
      // ✅ Todos los documentos encontrados
      this.logger.log(`✅ [CONSOLIDATE] Todos los documentos presentes, consolidando...`);
      await this.createConsolidatedLog(recordId, timestamp, foundFiles);
      return;
    }

    // ❌ Faltan documentos
    const missing = expectedDocs.filter(doc =>
      !foundDocs.includes(doc)
    );
    this.logger.log(`⚠️ [CONSOLIDATE] Documentos faltantes: ${missing.join(', ')}`);

    if (attempt < maxAttempts) {
      // Reintentar
      this.logger.log(`⏳ [CONSOLIDATE] Reintentando en ${retryDelay/1000}s... (intento ${attempt + 1}/${maxAttempts})`);
      setTimeout(() => {
        this.consolidateWithRetry(recordId, timestamp, attempt + 1);
      }, retryDelay);
    } else {
      // Consolidar lo que hay después de todos los intentos
      this.logger.warn(`⚠️ [CONSOLIDATE] Consolidando ${foundFiles.length} archivos después de ${attempt} intentos`);
      await this.createConsolidatedLog(recordId, timestamp, foundFiles);
    }
  }

  /**
   * Crear archivo consolidado con todos los logs
   * @param recordId - ID del record
   * @param timestamp - Timestamp en formato aammddhhmm
   * @param files - Array de nombres de archivos a consolidar
   */
  async createConsolidatedLog(
    recordId: string,
    timestamp: string,
    files: string[]
  ): Promise<void> {
    const consolidatedFilename = `${timestamp}_${recordId}_ALL.log`;
    const consolidatedPath = path.join(this.logsDirectory, consolidatedFilename);

    try {
      let consolidatedContent = this.buildHeader(recordId, timestamp, files);

      // Leer cada archivo y agregarlo
      for (const filename of files) {
        const docName = filename.match(/_([A-Z]+)\.log$/)?.[1] || 'UNKNOWN';
        const filePath = path.join(this.logsDirectory, filename);

        try {
          const content = await fs.promises.readFile(filePath, 'utf8');
          const lines = content.split('\n').filter(l => l.trim());

          consolidatedContent += `\n${'='.repeat(80)}\n`;
          consolidatedContent += `DOCUMENT: ${docName}\n`;
          consolidatedContent += `File: ${filename}\n`;
          consolidatedContent += `Lines: ${lines.length}\n`;
          consolidatedContent += `${'='.repeat(80)}\n`;
          consolidatedContent += content;
          consolidatedContent += '\n';
        } catch (error) {
          this.logger.error(`❌ [CONSOLIDATE] Error leyendo ${filename}: ${error.message}`);
          consolidatedContent += `\n${'='.repeat(80)}\n`;
          consolidatedContent += `DOCUMENT: ${docName}\n`;
          consolidatedContent += `ERROR: No se pudo leer el archivo\n`;
          consolidatedContent += `${'='.repeat(80)}\n\n`;
        }
      }

      // Escribir archivo consolidado
      await fs.promises.writeFile(consolidatedPath, consolidatedContent, 'utf8');

      this.logger.log(`💾 [CONSOLIDATE] ✅ Archivo consolidado creado: ${consolidatedFilename}`);
      this.logger.log(`📊 [CONSOLIDATE] Total documentos consolidados: ${files.length}`);

      // Calcular tamaño del archivo
      const stats = await fs.promises.stat(consolidatedPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      this.logger.log(`📦 [CONSOLIDATE] Tamaño archivo: ${sizeMB}MB`);

    } catch (error) {
      this.logger.error(`❌ [CONSOLIDATE] Error creando archivo consolidado: ${error.message}`);
    }
  }

  /**
   * Construir header del archivo consolidado
   * @private
   */
  private buildHeader(recordId: string, timestamp: string, files: string[]): string {
    const docs = files.map(f => f.match(/_([A-Z]+)\.log$/)?.[1]).filter(Boolean);

    return `${'='.repeat(80)}
CONSOLIDATED LOG FILE
${'='.repeat(80)}
Record ID: ${recordId}
Timestamp: ${timestamp}
Generated: ${new Date().toISOString()}
Documents: ${files.length} (${docs.join(', ')})
${'='.repeat(80)}\n\n`;
  }

  /**
   * Parsear timestamp aammddhhmm a Date
   * @private
   */
  private parseTimestamp(ts: string): Date {
    // "2510281331" -> 2025-10-28 13:31
    const year = 2000 + parseInt(ts.substring(0, 2));
    const month = parseInt(ts.substring(2, 4)) - 1; // 0-indexed
    const day = parseInt(ts.substring(4, 6));
    const hour = parseInt(ts.substring(6, 8));
    const minute = parseInt(ts.substring(8, 10));

    return new Date(year, month, day, hour, minute);
  }
}
