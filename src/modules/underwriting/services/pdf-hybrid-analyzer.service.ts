import { Injectable, Logger } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { PdfImageService } from './pdf-image.service';
import { OpenAiService } from './openai.service';
import { ResponseType } from '../entities/uw-evaluation.entity';

/**
 * Servicio híbrido que combina Vision API + OCR para análisis completo de PDFs
 * Optimizado para manejar formularios complejos, documentos escaneados y firmas
 */
@Injectable()
export class PdfHybridAnalyzerService {
  private readonly logger = new Logger(PdfHybridAnalyzerService.name);

  constructor(
    private readonly pdfImageService: PdfImageService,
    private readonly openAiService: OpenAiService,
  ) {}

  /**
   * Análisis híbrido: Vision API para campos específicos + OCR para texto general
   */
  async analyzeDocument(
    buffer: Buffer,
    prompts: Array<{
      prompt: string;
      expectedType: ResponseType;
      pmcField?: string;
    }>,
    options: {
      useOcr: boolean;
      useVision: boolean;
      analyzeSignatures: boolean;
      maxImageSize?: number;
    } = {
      useOcr: true,
      useVision: true,
      analyzeSignatures: true
    }
  ): Promise<{
    ocrText: string;
    visionAnalysis: Array<{
      prompt: string;
      response: any;
      confidence: number;
      method: 'vision' | 'ocr' | 'hybrid';
    }>;
    coordinates: Array<{
      field: string;
      x: number;
      y: number;
      width: number;
      height: number;
      confidence: number;
    }>;
    metadata: {
      processingTime: number;
      imagePages: number;
      ocrConfidence: number;
      largeFile: boolean;
    };
  }> {
    const startTime = Date.now();
    const results = {
      ocrText: '',
      visionAnalysis: [] as Array<any>,
      coordinates: [] as Array<any>,
      metadata: {
        processingTime: 0,
        imagePages: 0,
        ocrConfidence: 0,
        largeFile: buffer.length > 20971520 // 20MB
      }
    };

    try {
      this.logger.log(`🔬 Iniciando análisis híbrido - OCR: ${options.useOcr}, Vision: ${options.useVision}`);
      
      // PASO 1: Convertir PDF a imágenes
      let imageBase64Array: string[] = [];
      
      if (options.useVision || options.useOcr) {
        try {
          const pdfBase64 = buffer.toString('base64');
          const imageMap = await this.pdfImageService.convertPages(pdfBase64, [1, 2, 3, 4, 5]);
          imageBase64Array = Array.from(imageMap.values());
          results.metadata.imagePages = imageBase64Array.length;
          this.logger.log(`📷 Convertidas ${imageBase64Array.length} páginas a imágenes`);
        } catch (imageError) {
          this.logger.warn(`⚠️ Error convirtiendo a imágenes: ${imageError.message}`);
          
          // Si falla por tamaño, intentar solo primera página
          if (imageError.message.includes('too large')) {
            try {
              const firstPageImage = await this.pdfImageService.convertSinglePage(buffer, 1);
              imageBase64Array = [firstPageImage];
              results.metadata.imagePages = 1;
              this.logger.log(`📷 Convertida solo primera página debido al tamaño`);
            } catch (singlePageError) {
              this.logger.error(`❌ No se pudo convertir ni una página: ${singlePageError.message}`);
            }
          }
        }
      }

      // PASO 2: OCR para texto general (si está habilitado)
      if (options.useOcr && imageBase64Array.length > 0) {
        try {
          this.logger.log('🔤 Iniciando OCR con Tesseract...');
          results.ocrText = await this.performOCR(imageBase64Array);
          this.logger.log(`✅ OCR completo: ${results.ocrText.length} caracteres extraídos`);
        } catch (ocrError) {
          this.logger.warn(`⚠️ OCR falló: ${ocrError.message}`);
        }
      }

      // PASO 3: Vision API para análisis específico de campos (si está habilitado)
      if (options.useVision && imageBase64Array.length > 0) {
        for (const promptData of prompts) {
          try {
            // Determinar si este prompt necesita análisis visual
            const needsVisual = this.requiresVisualAnalysis(promptData.prompt);
            
            if (needsVisual) {
              this.logger.log(`👁️ Analizando con Vision API: "${promptData.prompt.substring(0, 50)}..."`);
              
              // Analizar cada página o solo las relevantes
              const pagesToAnalyze = options.analyzeSignatures ? 
                imageBase64Array : // Todas las páginas para firmas
                [imageBase64Array[imageBase64Array.length - 1]]; // Solo última para firmas
              
              for (let i = 0; i < pagesToAnalyze.length; i++) {
                const pageImage = pagesToAnalyze[i];
                const pageNumber = options.analyzeSignatures ? i + 1 : imageBase64Array.length;
                
                try {
                  const visionResult = await this.openAiService.evaluateWithVision(
                    pageImage,
                    promptData.prompt,
                    promptData.expectedType,
                    promptData.pmcField,
                    pageNumber
                  );

                  results.visionAnalysis.push({
                    prompt: promptData.prompt,
                    response: visionResult,
                    confidence: this.calculateVisionConfidence(visionResult),
                    method: 'vision'
                  });

                  // Si encontramos respuesta satisfactoria, no necesitamos más páginas
                  if (visionResult.response !== 'NOT_FOUND' && visionResult.response !== 'NO') {
                    break;
                  }
                } catch (visionError) {
                  this.logger.warn(`⚠️ Vision API falló en página ${pageNumber}: ${visionError.message}`);
                }
              }
            } else {
              // Usar OCR + análisis de texto para campos no visuales
              if (results.ocrText) {
                results.visionAnalysis.push({
                  prompt: promptData.prompt,
                  response: this.analyzeTextForPrompt(results.ocrText, promptData.prompt, promptData.expectedType),
                  confidence: 0.7,
                  method: 'ocr'
                });
              }
            }
          } catch (promptError) {
            this.logger.error(`❌ Error procesando prompt: ${promptError.message}`);
          }
        }
      }

      // PASO 4: Combinar resultados y generar coordenadas aproximadas
      if (options.analyzeSignatures && imageBase64Array.length > 0) {
        try {
          results.coordinates = await this.extractFieldCoordinates(imageBase64Array[0]);
        } catch (coordError) {
          this.logger.warn(`⚠️ Error extrayendo coordenadas: ${coordError.message}`);
        }
      }

      results.metadata.processingTime = Date.now() - startTime;
      this.logger.log(`✅ Análisis híbrido completo en ${results.metadata.processingTime}ms`);
      
      return results;

    } catch (error) {
      this.logger.error(`❌ Error en análisis híbrido: ${error.message}`);
      throw error;
    }
  }

  /**
   * Realiza OCR en múltiples imágenes y combina el texto
   */
  private async performOCR(imageBase64Array: string[]): Promise<string> {
    const worker = await createWorker('eng+spa', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          this.logger.debug(`🔤 OCR progreso: ${(m.progress * 100).toFixed(0)}%`);
        }
      }
    });

    let combinedText = '';
    
    try {
      for (let i = 0; i < imageBase64Array.length; i++) {
        this.logger.log(`🔤 Procesando página ${i + 1}/${imageBase64Array.length} con OCR`);
        
        // Convertir base64 a buffer para tesseract
        const imageBuffer = Buffer.from(imageBase64Array[i], 'base64');
        
        const { data } = await worker.recognize(imageBuffer);
        
        if (data.text && data.text.trim().length > 0) {
          combinedText += `\n=== PAGE ${i + 1} OCR TEXT ===\n`;
          combinedText += data.text.trim();
          combinedText += `\n=== END PAGE ${i + 1} ===\n`;
          
          this.logger.log(`✅ Página ${i + 1}: ${data.text.length} caracteres (confianza: ${data.confidence}%)`);
        }
      }
      
      return combinedText;
    } finally {
      await worker.terminate();
    }
  }

  /**
   * Analiza texto OCR para responder un prompt específico
   */
  private analyzeTextForPrompt(ocrText: string, prompt: string, expectedType: ResponseType): any {
    // Análisis básico de texto para campos no visuales
    const text = ocrText.toLowerCase();
    const promptLower = prompt.toLowerCase();
    
    // Buscar patrones comunes según el tipo esperado
    if (expectedType === ResponseType.BOOLEAN) {
      if (text.includes('yes') || text.includes('sí') || text.includes('✓') || text.includes('checked')) {
        return { result: 'YES', confidence: 0.7, source: 'ocr' };
      } else if (text.includes('no') || text.includes('✗') || text.includes('unchecked')) {
        return { result: 'NO', confidence: 0.7, source: 'ocr' };
      }
    } else if (expectedType === ResponseType.DATE) {
      const datePattern = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g;
      const dates = text.match(datePattern);
      if (dates && dates.length > 0) {
        return { result: dates[0], confidence: 0.8, source: 'ocr' };
      }
    } else if (expectedType === ResponseType.NUMBER) {
      const amountPattern = /\$[\d,]+\.?\d*/g;
      const amounts = text.match(amountPattern);
      if (amounts && amounts.length > 0) {
        return { result: amounts[0], confidence: 0.8, source: 'ocr' };
      }
    }
    
    return { result: 'NOT_FOUND', confidence: 0.3, source: 'ocr' };
  }

  /**
   * Determina si un prompt requiere análisis visual
   */
  private requiresVisualAnalysis(prompt: string): boolean {
    const visualKeywords = [
      'sign', 'signature', 'signed', 'firma', 'firmado',
      'image', 'photo', 'picture', 'imagen', 'foto',
      'stamp', 'seal', 'watermark', 'sello',
      'checkbox', 'checked', 'tick', 'mark', 'marca',
      'handwritten', 'written', 'escrito'
    ];

    const promptLower = prompt.toLowerCase();
    return visualKeywords.some(keyword => promptLower.includes(keyword));
  }

  /**
   * Calcula la confianza de una respuesta de Vision API
   */
  private calculateVisionConfidence(visionResult: any): number {
    if (!visionResult || visionResult.response === 'NOT_FOUND') {
      return 0.1;
    }
    
    if (visionResult.response === 'YES' || visionResult.response === 'NO') {
      return 0.8;
    }
    
    if (visionResult.response && visionResult.response.length > 0) {
      return 0.7;
    }
    
    return 0.5;
  }

  /**
   * Extrae coordenadas aproximadas de campos usando análisis de imagen
   */
  private async extractFieldCoordinates(imageBase64: string): Promise<Array<{
    field: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  }>> {
    try {
      // Análisis básico de coordenadas usando OCR con información de posición
      const worker = await createWorker('eng+spa', 1);
      
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const { data } = await worker.recognize(imageBuffer, {
        // tessedit_create_hocr: '1'  // Comentado por compatibilidad
      });
      
      await worker.terminate();
      
      const coordinates = [];
      
      // Extraer coordenadas de elementos importantes del HOCR
      if (data.hocr) {
        const bboxPattern = /bbox (\d+) (\d+) (\d+) (\d+)/g;
        const wordPattern = /<span class='ocrx_word'[^>]*bbox (\d+) (\d+) (\d+) (\d+)[^>]*>([^<]+)</g;
        
        let match;
        while ((match = wordPattern.exec(data.hocr)) !== null) {
          const [, x1, y1, x2, y2, text] = match;
          
          // Solo incluir campos relevantes (firmas, fechas, nombres, etc.)
          if (this.isRelevantField(text)) {
            coordinates.push({
              field: text.trim(),
              x: parseInt(x1),
              y: parseInt(y1),
              width: parseInt(x2) - parseInt(x1),
              height: parseInt(y2) - parseInt(y1),
              confidence: 0.6
            });
          }
        }
      }
      
      return coordinates;
    } catch (error) {
      this.logger.warn(`⚠️ Error extrayendo coordenadas: ${error.message}`);
      return [];
    }
  }

  /**
   * Determina si un texto es un campo relevante para extraer coordenadas
   */
  private isRelevantField(text: string): boolean {
    const relevantPatterns = [
      /signature/i,
      /signed/i,
      /date/i,
      /name/i,
      /amount/i,
      /\$\d+/,
      /\d{1,2}\/\d{1,2}\/\d{2,4}/,
      /yes|no/i,
      /checked|unchecked/i
    ];

    return relevantPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Método específico para análisis de firmas con mayor precisión
   */
  async analyzeSignatures(
    buffer: Buffer,
    signaturePrompts: string[]
  ): Promise<Array<{
    prompt: string;
    hasSig

ature: boolean;
    confidence: number;
    location: { page: number; coordinates?: { x: number; y: number; width: number; height: number } };
    method: 'vision' | 'ocr' | 'hybrid';
  }>> {
    try {
      this.logger.log('✍️ Análisis especializado de firmas iniciado');
      
      const pdfBase64 = buffer.toString('base64');
      const imageMap = await this.pdfImageService.convertPages(pdfBase64);
      const imageBase64Array = Array.from(imageMap.values());
      const signatureResults = [];

      for (const prompt of signaturePrompts) {
        this.logger.log(`🔍 Analizando firma: "${prompt.substring(0, 50)}..."`);
        
        let bestResult = {
          prompt,
          hasSignature: false,
          confidence: 0,
          location: { page: 1 },
          method: 'hybrid' as 'vision' | 'ocr' | 'hybrid'
        };

        // Analizar cada página buscando firmas
        for (let pageIndex = 0; pageIndex < imageBase64Array.length; pageIndex++) {
          const pageNumber = pageIndex + 1;
          
          try {
            // Vision API con prompt específico para firmas
            const visionPrompt = `${prompt}\n\nAnalyze this page carefully for ANY visual signatures, handwritten signatures, electronic signatures, signature lines that have been filled, or signature stamps. Look for any marks that indicate the document has been signed. Return YES if you find any type of signature, NO if completely unsigned.`;
            
            const visionResult = await this.openAiService.evaluateWithVision(
              imageBase64Array[pageIndex],
              visionPrompt,
              ResponseType.BOOLEAN,
              undefined,
              pageNumber
            );

            const hasSignature = visionResult.response === 'YES';
            const confidence = hasSignature ? 0.85 : 0.7;

            if (confidence > bestResult.confidence) {
              bestResult = {
                prompt,
                hasSignature,
                confidence,
                location: { page: pageNumber },
                method: 'vision' as 'vision' | 'ocr' | 'hybrid'
              };
            }

            this.logger.log(`📄 Página ${pageNumber}: ${hasSignature ? 'CON firma' : 'sin firma'} (confianza: ${(confidence * 100).toFixed(0)}%)`);

          } catch (pageError) {
            this.logger.warn(`⚠️ Error analizando página ${pageNumber}: ${pageError.message}`);
          }
        }

        signatureResults.push(bestResult);
      }

      this.logger.log(`✅ Análisis de firmas completo: ${signatureResults.filter(r => r.hasSignature).length}/${signatureResults.length} con firmas detectadas`);
      return signatureResults;

    } catch (error) {
      this.logger.error(`❌ Error en análisis de firmas: ${error.message}`);
      throw error;
    }
  }
}