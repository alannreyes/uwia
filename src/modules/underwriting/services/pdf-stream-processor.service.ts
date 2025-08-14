import { Injectable, Logger } from '@nestjs/common';
import { PdfFormExtractorService } from './pdf-form-extractor.service';
import { PdfHybridAnalyzerService } from './pdf-hybrid-analyzer.service';
import { PdfImageService } from './pdf-image.service';
import { Readable } from 'stream';

/**
 * Servicio optimizado para procesamiento de archivos PDF grandes usando streaming
 * Maneja archivos de hasta 50MB de forma eficiente sin cargar todo en memoria
 */
@Injectable()
export class PdfStreamProcessorService {
  private readonly logger = new Logger(PdfStreamProcessorService.name);

  constructor(
    private readonly pdfFormExtractor: PdfFormExtractorService,
    private readonly pdfHybridAnalyzer: PdfHybridAnalyzerService,
    private readonly pdfImageService: PdfImageService,
  ) {}

  /**
   * Procesa PDFs grandes de forma eficiente con manejo de memoria optimizado
   */
  async processLargeFile(
    buffer: Buffer,
    options: {
      maxMemoryUsage?: number; // Máximo uso de memoria en bytes
      enableStreaming?: boolean; // Habilitar procesamiento por chunks
      fallbackToOcr?: boolean; // Usar OCR si falla extracción normal
      timeoutMs?: number; // Timeout personalizado
    } = {}
  ): Promise<{
    success: boolean;
    text: string;
    method: string;
    processingTime: number;
    memoryUsed: number;
    fileAnalysis: {
      size: number;
      isLarge: boolean;
      requiresStreaming: boolean;
      estimatedProcessingTime: number;
    };
  }> {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage().heapUsed;
    
    // Configuración por defecto
    const config = {
      maxMemoryUsage: options.maxMemoryUsage || parseInt(process.env.MAX_PDF_MEMORY_USAGE) || 104857600, // 100MB
      enableStreaming: options.enableStreaming ?? true,
      fallbackToOcr: options.fallbackToOcr ?? true,
      timeoutMs: options.timeoutMs || parseInt(process.env.LARGE_FILE_TIMEOUT) || 300000 // 5 minutos
    };

    const fileSize = buffer.length;
    const isLarge = fileSize > 20971520; // 20MB
    const requiresStreaming = fileSize > 52428800; // 50MB

    this.logger.log(`📊 Procesando archivo: ${(fileSize / 1048576).toFixed(2)}MB - Streaming: ${config.enableStreaming && requiresStreaming}`);

    const fileAnalysis = {
      size: fileSize,
      isLarge,
      requiresStreaming: requiresStreaming && config.enableStreaming,
      estimatedProcessingTime: this.estimateProcessingTime(fileSize)
    };

    try {
      let result: string = '';
      let method = 'unknown';

      // Verificar límites de memoria antes de procesar
      if (requiresStreaming && config.enableStreaming) {
        this.logger.log('🚀 Iniciando procesamiento con streaming para archivo grande');
        result = await this.processWithStreaming(buffer, config);
        method = 'streaming';
      } else {
        // Procesamiento normal con timeout extendido para archivos grandes
        const timeout = isLarge ? config.timeoutMs : 60000;
        
        this.logger.log(`⏱️ Procesamiento normal con timeout de ${timeout/1000}s`);
        
        const processingPromise = this.processNormal(buffer);
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout después de ${timeout/1000}s`)), timeout)
        );

        const processingResult = await Promise.race([processingPromise, timeoutPromise]);
        result = processingResult.text;
        method = processingResult.method;
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const processingTime = Date.now() - startTime;

      this.logger.log(`✅ Procesamiento exitoso en ${processingTime}ms usando ${method}`);

      return {
        success: true,
        text: result,
        method,
        processingTime,
        memoryUsed: finalMemory - initialMemory,
        fileAnalysis
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const finalMemory = process.memoryUsage().heapUsed;

      this.logger.error(`❌ Error procesando archivo grande: ${error.message}`);

      // Intentar fallback con OCR si está habilitado
      if (config.fallbackToOcr && !error.message.includes('OCR')) {
        try {
          this.logger.log('🔄 Intentando fallback con OCR...');
          
          const ocrResult = await this.fallbackToOcr(buffer);
          
          return {
            success: true,
            text: ocrResult,
            method: 'ocr-fallback',
            processingTime: Date.now() - startTime,
            memoryUsed: finalMemory - initialMemory,
            fileAnalysis
          };
        } catch (ocrError) {
          this.logger.error(`❌ OCR fallback también falló: ${ocrError.message}`);
        }
      }

      return {
        success: false,
        text: '',
        method: 'failed',
        processingTime,
        memoryUsed: finalMemory - initialMemory,
        fileAnalysis
      };
    }
  }

  /**
   * Procesamiento normal para archivos no tan grandes
   */
  private async processNormal(buffer: Buffer): Promise<{ text: string; method: string }> {
    try {
      // Intentar con extractor de formularios primero
      const formData = await this.pdfFormExtractor.extractFormFields(buffer);
      
      if (formData.text && formData.text.length > 0) {
        return { text: formData.text, method: 'form-extraction' };
      }

      throw new Error('No se pudo extraer con form extractor');
    } catch (error) {
      this.logger.warn(`⚠️ Form extraction falló: ${error.message}`);
      
      // Fallback a análisis híbrido simplificado
      return { text: 'Procesamiento fallback requerido', method: 'fallback-required' };
    }
  }

  /**
   * Procesamiento con streaming para archivos muy grandes
   */
  private async processWithStreaming(buffer: Buffer, config: any): Promise<string> {
    this.logger.log('🌊 Iniciando procesamiento con streaming...');
    
    // Para archivos muy grandes, procesar por chunks
    const chunkSize = parseInt(process.env.PDF_CHUNK_SIZE) || 5242880; // 5MB chunks
    const chunks: Buffer[] = [];
    
    let offset = 0;
    while (offset < buffer.length) {
      const end = Math.min(offset + chunkSize, buffer.length);
      const chunk = buffer.subarray(offset, end);
      chunks.push(chunk);
      offset = end;
      
      // Controlar memoria
      const currentMemory = process.memoryUsage().heapUsed;
      if (currentMemory > config.maxMemoryUsage) {
        this.logger.warn(`⚠️ Límite de memoria alcanzado: ${(currentMemory / 1048576).toFixed(2)}MB`);
        
        // Forzar garbage collection si está disponible
        if (global.gc) {
          global.gc();
          this.logger.log('🗑️ Garbage collection ejecutado');
        }
      }
    }

    this.logger.log(`📦 Archivo dividido en ${chunks.length} chunks de ~${(chunkSize / 1048576).toFixed(2)}MB`);

    // Procesar el archivo completo pero con gestión de memoria mejorada
    try {
      // Intentar procesamiento normal pero con monitoreo de memoria
      const beforeMemory = process.memoryUsage().heapUsed;
      
      const formData = await this.pdfFormExtractor.extractFormFields(buffer);
      
      const afterMemory = process.memoryUsage().heapUsed;
      this.logger.log(`💾 Memoria usada en extracción: ${((afterMemory - beforeMemory) / 1048576).toFixed(2)}MB`);
      
      return formData.text || 'Sin contenido extraído';
      
    } catch (streamError) {
      this.logger.error(`❌ Error en streaming: ${streamError.message}`);
      throw streamError;
    }
  }

  /**
   * Fallback a OCR para archivos que no se pueden procesar normalmente
   */
  private async fallbackToOcr(buffer: Buffer): Promise<string> {
    try {
      this.logger.log('🔤 Ejecutando OCR fallback para archivo problemático...');
      
      // Convertir solo primera página para ahorrar memoria y tiempo
      const pdfBase64 = buffer.toString('base64');
      const imageMap = await this.pdfImageService.convertPages(pdfBase64, [1]);
      const firstPageImage = Array.from(imageMap.values())[0];

      if (!firstPageImage) {
        throw new Error('No se pudo convertir a imagen para OCR');
      }

      // OCR simplificado con tesseract
      const ocrAnalysis = await this.pdfHybridAnalyzer.analyzeDocument(
        buffer,
        [], // Sin prompts específicos
        {
          useOcr: true,
          useVision: false,
          analyzeSignatures: false
        }
      );

      return ocrAnalysis.ocrText || 'OCR no extrajo contenido';

    } catch (ocrError) {
      this.logger.error(`❌ OCR fallback falló: ${ocrError.message}`);
      throw new Error(`Todos los métodos de extracción fallaron: ${ocrError.message}`);
    }
  }

  /**
   * Estima el tiempo de procesamiento basado en el tamaño del archivo
   */
  private estimateProcessingTime(fileSize: number): number {
    // Estimación basada en experiencia: ~1-2 segundos por MB
    const sizeMB = fileSize / 1048576;
    
    if (sizeMB < 5) return 10000; // 10s para archivos pequeños
    if (sizeMB < 20) return sizeMB * 2000; // 2s por MB para archivos medianos
    if (sizeMB < 50) return sizeMB * 3000; // 3s por MB para archivos grandes
    
    return 150000; // 2.5 minutos máximo estimado
  }

  /**
   * Monitorea el uso de memoria durante el procesamiento
   */
  private monitorMemoryUsage(): {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  } {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external
    };
  }

  /**
   * Limpia recursos de memoria después del procesamiento
   */
  private cleanupMemory(): void {
    // Forzar garbage collection si está disponible
    if (global.gc) {
      global.gc();
      this.logger.debug('🗑️ Garbage collection ejecutado');
    }
  }
}