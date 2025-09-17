import { Injectable, Logger } from '@nestjs/common';
import { ResponseType } from '../entities/uw-evaluation.entity';

// Importar Gemini SDK
let GoogleGenerativeAI: any;
let GoogleAIFileManager: any;
let FileState: any;

try {
  ({ GoogleGenerativeAI, GoogleAIFileManager, FileState } = require('@google/generative-ai'));
} catch (error) {
  // SDK no disponible - el servicio se deshabilitará
}

export interface GeminiFileApiResult {
  response: string;
  confidence: number;
  reasoning?: string;
  processingTime: number;
  tokensUsed: number;
  model: string;
  method: 'inline' | 'file-api';
}

@Injectable()
export class GeminiFileApiService {
  private readonly logger = new Logger(GeminiFileApiService.name);
  private geminiClient?: any;
  private fileManager?: any;
  private model?: any;
  
  // Threshold de 20MB para decidir entre inline vs file API
  private readonly FILE_SIZE_THRESHOLD_MB = 20;
  private readonly FILE_SIZE_THRESHOLD_BYTES = this.FILE_SIZE_THRESHOLD_MB * 1024 * 1024;
  
  constructor() {
    this.initializeGemini();
  }

  private initializeGemini(): void {
    const apiKey = process.env.GEMINI_API_KEY;
    const enabled = process.env.GEMINI_ENABLED === 'true';
    
    if (!enabled || !apiKey) {
      this.logger.warn('🟡 Gemini File API está deshabilitado o no configurado');
      return;
    }
    
    if (!GoogleGenerativeAI || !GoogleAIFileManager) {
      this.logger.error('❌ @google/generative-ai no está instalado');
      return;
    }
    
    try {
      this.geminiClient = new GoogleGenerativeAI(apiKey);
      this.fileManager = new GoogleAIFileManager(apiKey);
      this.model = this.geminiClient.getGenerativeModel({ 
        model: 'gemini-2.5-pro',
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192,
        },
      });
      
      this.logger.log('✅ Gemini File API Service inicializado correctamente');
      this.logger.log(`📏 Threshold: ${this.FILE_SIZE_THRESHOLD_MB}MB (File API para archivos mayores)`);
    } catch (error) {
      this.logger.error(`❌ Error inicializando Gemini File API: ${error.message}`);
    }
  }

  /**
   * Procesa PDF usando Inline API (< 20MB) o File API (> 20MB)
   */
  async processPdfDocument(
    pdfBuffer: Buffer,
    filename: string,
    prompt: string,
    expectedType: ResponseType = ResponseType.TEXT
  ): Promise<GeminiFileApiResult> {
    const startTime = Date.now();
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);
    
    this.logger.log(`📄 Procesando PDF: ${filename} (${fileSizeMB.toFixed(2)}MB)`);
    
    if (!this.isAvailable()) {
      throw new Error('Gemini File API Service no está disponible');
    }
    
    try {
      // Decidir método basado en tamaño
      if (pdfBuffer.length > this.FILE_SIZE_THRESHOLD_BYTES) {
        this.logger.log(`🔄 Archivo grande (${fileSizeMB.toFixed(2)}MB) - usando File API`);
        return await this.processWithFileApi(pdfBuffer, filename, prompt, expectedType, startTime);
      } else {
        this.logger.log(`📝 Archivo pequeño (${fileSizeMB.toFixed(2)}MB) - usando Inline API`);
        return await this.processWithInlineApi(pdfBuffer, prompt, expectedType, startTime);
      }
    } catch (error) {
      this.logger.error(`❌ Error procesando PDF ${filename}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Procesa usando File API de Gemini (para archivos > 20MB)
   */
  private async processWithFileApi(
    pdfBuffer: Buffer,
    filename: string,
    prompt: string,
    expectedType: ResponseType,
    startTime: number
  ): Promise<GeminiFileApiResult> {
    this.logger.log(`🚀 [FILE-API] Iniciando upload de ${filename}`);
    
    try {
      // 1. Upload del archivo a Gemini
      const uploadResponse = await this.fileManager.uploadFile(pdfBuffer, {
        mimeType: 'application/pdf',
        displayName: filename,
      });
      
      this.logger.log(`📤 [FILE-API] Archivo subido: ${uploadResponse.file.name}`);
      
      // 2. Esperar a que el archivo esté procesado
      let file = await this.fileManager.getFile(uploadResponse.file.name);
      let attempts = 0;
      const maxAttempts = 30; // 5 minutos máximo
      
      while (file.state === FileState.PROCESSING && attempts < maxAttempts) {
        this.logger.log(`⏳ [FILE-API] Esperando procesamiento... (${attempts + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 segundos
        file = await this.fileManager.getFile(uploadResponse.file.name);
        attempts++;
      }
      
      if (file.state !== FileState.ACTIVE) {
        throw new Error(`Archivo no se pudo procesar. Estado: ${file.state}`);
      }
      
      this.logger.log(`✅ [FILE-API] Archivo listo para procesamiento`);
      
      // 3. Procesar con Gemini usando File API
      const fullPrompt = this.buildPrompt(prompt, expectedType);
      const result = await this.model.generateContent([
        fullPrompt,
        {
          fileData: {
            mimeType: file.mimeType,
            fileUri: file.uri
          }
        }
      ]);
      
      const response = result.response;
      const text = response.text();
      
      // 4. Limpiar archivo temporal
      try {
        await this.fileManager.deleteFile(uploadResponse.file.name);
        this.logger.log(`🗑️ [FILE-API] Archivo temporal eliminado`);
      } catch (deleteError) {
        this.logger.warn(`⚠️ [FILE-API] No se pudo eliminar archivo temporal: ${deleteError.message}`);
      }
      
      // 5. Parsear respuesta
      const evaluation = this.parseResponse(text, expectedType);
      const processingTime = Date.now() - startTime;
      
      this.logger.log(`✅ [FILE-API] Completado en ${processingTime}ms`);
      
      return {
        ...evaluation,
        processingTime,
        tokensUsed: response.usageMetadata?.totalTokenCount || 0,
        model: 'gemini-2.5-pro-file-api',
        method: 'file-api'
      };
      
    } catch (error) {
      this.logger.error(`❌ [FILE-API] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Procesa usando Inline API de Gemini (para archivos < 20MB)
   */
  private async processWithInlineApi(
    pdfBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType,
    startTime: number
  ): Promise<GeminiFileApiResult> {
    this.logger.log(`📝 [INLINE-API] Procesando con Inline API`);
    
    try {
      const base64Data = pdfBuffer.toString('base64');
      const fullPrompt = this.buildPrompt(prompt, expectedType);
      
      const result = await this.model.generateContent([
        fullPrompt,
        {
          inlineData: {
            mimeType: "application/pdf",
            data: base64Data
          }
        }
      ]);
      
      const response = result.response;
      const text = response.text();
      
      const evaluation = this.parseResponse(text, expectedType);
      const processingTime = Date.now() - startTime;
      
      this.logger.log(`✅ [INLINE-API] Completado en ${processingTime}ms`);
      
      return {
        ...evaluation,
        processingTime,
        tokensUsed: response.usageMetadata?.totalTokenCount || 0,
        model: 'gemini-2.5-pro-inline',
        method: 'inline'
      };
      
    } catch (error) {
      this.logger.error(`❌ [INLINE-API] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Construye el prompt optimizado para procesamiento de documentos
   */
  private buildPrompt(prompt: string, expectedType: ResponseType): string {
    let systemPrompt = '';
    
    switch (expectedType) {
      case ResponseType.NUMBER:
        systemPrompt = 'Extract numeric amounts from this document. Return only the numeric value.';
        break;
      case ResponseType.DATE:
        systemPrompt = 'Extract dates from this document. Return in YYYY-MM-DD format.';
        break;
      case ResponseType.BOOLEAN:
        systemPrompt = 'Analyze this document and respond with YES or NO based on the question.';
        break;
      case ResponseType.JSON:
        systemPrompt = 'Analyze this document and return the response in valid JSON format.';
        break;
      case ResponseType.TEXT:
      default:
        systemPrompt = 'Analyze this document thoroughly and provide a comprehensive response.';
    }
    
    return `${systemPrompt}\n\nDocument Analysis Request:\n${prompt}\n\nProvide a clear, accurate response based on the document content.`;
  }

  /**
   * Parsea la respuesta de Gemini
   */
  private parseResponse(text: string, expectedType: ResponseType): { response: string; confidence: number; reasoning?: string } {
    // Extraer confianza si está presente
    let confidence = 0.85; // Default
    let cleanResponse = text.trim();
    let reasoning = undefined;
    
    // Buscar patrones de confianza
    const confidenceMatch = text.match(/confidence[:\s]+([0-9.]+)/i);
    if (confidenceMatch) {
      confidence = Math.min(parseFloat(confidenceMatch[1]), 1.0);
    }
    
    // Buscar reasoning si está presente
    const reasoningMatch = text.match(/reasoning[:\s]+(.+)/i);
    if (reasoningMatch) {
      reasoning = reasoningMatch[1].trim();
    }
    
    // Limpiar la respuesta basada en el tipo esperado
    switch (expectedType) {
      case ResponseType.NUMBER:
        const currencyMatch = cleanResponse.match(/[\d,]+\.?\d*/);
        if (currencyMatch) {
          cleanResponse = currencyMatch[0].replace(/,/g, '');
        }
        break;
      case ResponseType.DATE:
        const dateMatch = cleanResponse.match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch) {
          cleanResponse = dateMatch[0];
        }
        break;
      case ResponseType.BOOLEAN:
        cleanResponse = /yes|true|si|sí/i.test(cleanResponse) ? 'YES' : 'NO';
        break;
      case ResponseType.JSON:
        try {
          // Validar que sea JSON válido
          JSON.parse(cleanResponse);
        } catch {
          // Si no es JSON válido, envolver en JSON
          cleanResponse = JSON.stringify({ response: cleanResponse });
        }
        break;
    }
    
    return {
      response: cleanResponse,
      confidence,
      reasoning
    };
  }

  /**
   * Verifica si el servicio está disponible
   */
  isAvailable(): boolean {
    return !!(this.geminiClient && this.fileManager && this.model);
  }

  /**
   * Obtiene información del threshold configurado
   */
  getThresholdInfo(): { sizeMB: number; sizeBytes: number } {
    return {
      sizeMB: this.FILE_SIZE_THRESHOLD_MB,
      sizeBytes: this.FILE_SIZE_THRESHOLD_BYTES
    };
  }
}