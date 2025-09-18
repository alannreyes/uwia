import { Injectable, Logger } from '@nestjs/common';
import { ResponseType } from '../entities/uw-evaluation.entity';
import { PDFDocument } from 'pdf-lib';
import { ModernRAGService, ModernRAGResult } from './modern-rag-2025.service';

// Importar Gemini SDK según documentación oficial
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';

export interface GeminiFileApiResult {
  response: string;
  confidence: number;
  reasoning?: string;
  processingTime: number;
  tokensUsed: number;
  model: string;
  method: 'inline' | 'file-api' | 'file-api-split' | 'modern-rag';
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
  
  // Threshold de 30MB para activar Modern RAG
  private readonly MODERN_RAG_THRESHOLD_MB = 30;
  private readonly MODERN_RAG_THRESHOLD_BYTES = this.MODERN_RAG_THRESHOLD_MB * 1024 * 1024;
  
  constructor(
    private readonly modernRAGService: ModernRAGService
  ) {
    this.initializeGemini();
  }

  private initializeGemini(): void {
    const apiKey = process.env.GEMINI_API_KEY;
    const enabled = process.env.GEMINI_ENABLED === 'true';
    
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      this.logger.warn('🟡 Gemini File API está deshabilitado o no configurado - API Key no válida');
      return;
    }
    
    if (!enabled) {
      this.logger.warn('🟡 Gemini File API está deshabilitado (GEMINI_ENABLED=false)');
      return;
    }

    try {
      this.geminiClient = new GoogleGenerativeAI(apiKey);
      this.fileManager = new GoogleAIFileManager(apiKey);
      this.model = this.geminiClient.getGenerativeModel({ 
        model: 'gemini-1.5-pro',
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
   * Verifica si el servicio está habilitado y configurado correctamente
   */
  isEnabled(): boolean {
    return !!(this.geminiClient && this.fileManager && this.model);
  }

  /**
   * Punto de entrada principal para procesamiento de PDF
   */
  async processPdfDocument(
    pdfBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType = ResponseType.TEXT
  ): Promise<GeminiFileApiResult> {
    if (!this.isAvailable()) {
      throw new Error('GeminiFileApiService no está disponible');
    }

    const startTime = Date.now();
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);

    this.logger.log(`📄 Procesando PDF: ${prompt} (${fileSizeMB.toFixed(2)}MB)`);

    try {
      // Decisión inteligente de estrategia basada en tamaño y complejidad
      if (pdfBuffer.length > this.MODERN_RAG_THRESHOLD_BYTES) {
        this.logger.log(`🧠 Archivo muy grande (${fileSizeMB.toFixed(2)}MB) - usando Modern RAG 2025`);
        return await this.processWithModernRAG(pdfBuffer, prompt, expectedType, startTime);
      } else if (pdfBuffer.length > 50 * 1024 * 1024) { // > 50MB
        this.logger.log(`🔪 Archivo muy grande (${fileSizeMB.toFixed(2)}MB) - usando división automática`);
        return await this.processLargePdfWithSplitting(pdfBuffer, prompt, expectedType);
      } else if (pdfBuffer.length > this.FILE_SIZE_THRESHOLD_BYTES) {
        this.logger.log(`🔄 Archivo grande (${fileSizeMB.toFixed(2)}MB) - usando File API`);
        return await this.processWithFileApi(pdfBuffer, prompt, expectedType, startTime);
      } else {
        this.logger.log(`📝 Archivo pequeño (${fileSizeMB.toFixed(2)}MB) - usando Inline API`);
        return await this.processWithInlineApi(pdfBuffer, prompt, expectedType, startTime);
      }
    } catch (error) {
      this.logger.error(`❌ Error procesando PDF ${prompt}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Procesa usando Modern RAG 2025 para archivos muy grandes
   */
  private async processWithModernRAG(
    pdfBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType,
    startTime: number
  ): Promise<GeminiFileApiResult> {
    try {
      if (!this.modernRAGService.isAvailable()) {
        this.logger.warn(`⚠️ Modern RAG no disponible, fallback a PDF splitting`);
        return await this.processLargePdfWithSplitting(pdfBuffer, prompt, expectedType);
      }

      const ragResult: ModernRAGResult = await this.modernRAGService.processWithModernRAG(
        pdfBuffer,
        prompt,
        expectedType
      );

      // Convertir resultado de Modern RAG a formato GeminiFileApiResult
      return {
        response: ragResult.response,
        confidence: ragResult.confidence,
        reasoning: `${ragResult.reasoning} | Used ${ragResult.usedChunks}/${ragResult.totalChunks} chunks`,
        processingTime: ragResult.processingTime,
        tokensUsed: ragResult.tokensUsed,
        model: ragResult.model,
        method: 'modern-rag'
      };

    } catch (error) {
      this.logger.error(`❌ [MODERN-RAG] Error: ${error.message}, fallback a splitting`);
      return await this.processLargePdfWithSplitting(pdfBuffer, prompt, expectedType);
    }
  }

    /**
   * Procesa usando File API de Gemini (para archivos > 20MB)
   */
  private async processWithFileApi(
    pdfBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType,
    startTime: number
  ): Promise<GeminiFileApiResult> {
    this.logger.log(`🚀 [FILE-API] Iniciando upload de ${prompt}`);
    
    try {
      // 1. Subir archivo directamente usando File API (acepta Buffer)
      const uploadResponse = await this.fileManager.uploadFile(pdfBuffer, {
        mimeType: 'application/pdf',
        displayName: `document-${Date.now()}.pdf`,
      });
      
      this.logger.log(`📤 [FILE-API] Archivo subido: ${uploadResponse.file.name}`);
      
      // 3. Esperar a que el archivo esté listo (según documentación)
      let file = await this.fileManager.getFile(uploadResponse.file.name);
      while (file.state === FileState.PROCESSING) {
        this.logger.log(`⏳ [FILE-API] Procesando archivo... Estado: ${file.state}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        file = await this.fileManager.getFile(uploadResponse.file.name);
      }
      
      if (file.state === FileState.FAILED) {
        throw new Error('File processing failed');
      }
      
      this.logger.log(`✅ [FILE-API] Archivo listo para procesamiento`);
      
      // 4. Procesar con Gemini usando la estructura correcta según documentación
      const fullPrompt = this.buildPrompt(prompt, expectedType);
      
      // Estructura según documentación oficial
      const contents = [
        fullPrompt,
        {
          fileData: {
            mimeType: file.mimeType,
            fileUri: file.uri
          }
        }
      ];
      
      const result = await this.model.generateContent(contents);
      
      const response = result.response;
      const text = response.text();
      
      // 5. Limpiar archivo temporal
      try {
        await this.fileManager.deleteFile(uploadResponse.file.name);
        this.logger.log(`🗑️ [FILE-API] Archivo temporal eliminado`);
      } catch (deleteError) {
        this.logger.warn(`⚠️ [FILE-API] No se pudo eliminar archivo temporal: ${deleteError.message}`);
      }
      
      // 6. Parsear respuesta
      const evaluation = this.parseResponse(text, expectedType);
      const processingTime = Date.now() - startTime;
      
      this.logger.log(`✅ [FILE-API] Completado en ${processingTime}ms`);
      
      return {
        ...evaluation,
        processingTime,
        tokensUsed: response.usageMetadata?.totalTokenCount || 0,
        model: 'gemini-1.5-pro-file-api',
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
        systemPrompt = 'You are a precise document analyzer. Extract only the numeric value requested. Return only the number, no text.';
        break;
      case ResponseType.DATE:
        systemPrompt = 'You are a precise document analyzer. Extract only the date requested in MM-DD-YY format. Return only the date, no text.';
        break;
      case ResponseType.BOOLEAN:
        systemPrompt = 'You are a precise document analyzer. Answer only YES or NO based on the analysis. Return only YES or NO, no text.';
        break;
      case ResponseType.JSON:
        systemPrompt = 'You are a precise document analyzer. Return only valid JSON format. No additional text outside the JSON.';
        break;
      case ResponseType.TEXT:
      default:
        systemPrompt = 'You are a precise document analyzer. Follow the exact format specified in the request. Return only the requested format with no additional explanations, reasoning, or commentary.';
    }
    
    return `${systemPrompt}\n\n${prompt}`;
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
    
    // Limpiar respuesta de markdown, etiquetas y texto explicativo
    cleanResponse = cleanResponse
      .replace(/```[^`]*```/g, '') // Remover bloques de código
      .replace(/`([^`]+)`/g, '$1') // Remover backticks simples
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remover bold markdown
      .replace(/\*([^*]+)\*/g, '$1') // Remover italic markdown
      .replace(/#{1,6}\s+/g, '') // Remover headers markdown
      .replace(/\n\s*\n/g, '\n') // Reducir saltos de línea múltiples
      .trim();
    
    // Para respuestas con formato específico (como semicolons), extraer solo la línea relevante
    if (expectedType === ResponseType.TEXT && cleanResponse.includes(';')) {
      const lines = cleanResponse.split('\n');
      
      // Buscar la línea que contiene el formato esperado (con semicolons)
      for (const line of lines) {
        const trimmedLine = line.trim();
        // Si la línea tiene semicolons y no es explicativa
        if (trimmedLine.includes(';') && 
            !trimmedLine.toLowerCase().includes('explanation') &&
            !trimmedLine.toLowerCase().includes('format') &&
            !trimmedLine.toLowerCase().includes('return') &&
            !trimmedLine.startsWith('**') &&
            !trimmedLine.startsWith('#')) {
          cleanResponse = trimmedLine;
          break;
        }
      }
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
        const dateMatch = cleanResponse.match(/\d{2}-\d{2}-\d{2}/);
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
      case ResponseType.TEXT:
        // Para texto con formato específico, limpiar caracteres especiales al inicio/final
        cleanResponse = cleanResponse
          .replace(/^[`"'\s]+/, '') // Remover backticks, comillas y espacios al inicio
          .replace(/[`"'\s]+$/, '') // Remover backticks, comillas y espacios al final
          .trim();
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

  /**
   * Procesa PDFs grandes (> 50MB) dividiéndolos en chunks
   */
  async processLargePdfWithSplitting(
    pdfBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType = ResponseType.TEXT
  ): Promise<GeminiFileApiResult> {
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);
    this.logger.log(`🔪 [PDF-SPLIT] Iniciando división de PDF grande: ${fileSizeMB.toFixed(2)}MB`);
    
    const startTime = Date.now();
    
    try {
      // 1. Dividir PDF en chunks de máximo 40MB
      const pdfChunks = await this.splitPdfIntoChunks(pdfBuffer, 40); // 40MB chunks para estar seguro bajo el límite de 50MB
      
      this.logger.log(`🔪 [PDF-SPLIT] PDF dividido en ${pdfChunks.length} chunks`);
      
      // 2. Procesar cada chunk con Gemini
      const chunkResults: GeminiFileApiResult[] = [];
      
      for (let i = 0; i < pdfChunks.length; i++) {
        const chunk = pdfChunks[i];
        const chunkSizeMB = chunk.length / (1024 * 1024);
        
        this.logger.log(`🔄 [PDF-SPLIT] Procesando chunk ${i + 1}/${pdfChunks.length} (${chunkSizeMB.toFixed(2)}MB)`);
        
        try {
          // Procesar chunk individual
          const chunkResult = await this.processPdfDocument(chunk, `${prompt} (Analyzing part ${i + 1} of ${pdfChunks.length})`, expectedType);
          chunkResults.push(chunkResult);
          
          this.logger.log(`✅ [PDF-SPLIT] Chunk ${i + 1} completado en ${chunkResult.processingTime}ms`);
          
        } catch (chunkError) {
          this.logger.error(`❌ [PDF-SPLIT] Error en chunk ${i + 1}: ${chunkError.message}`);
          // Continuar con los otros chunks
        }
      }
      
      // 3. Consolidar resultados
      const consolidatedResult = this.consolidateChunkResults(chunkResults, prompt, expectedType);
      const totalTime = Date.now() - startTime;
      
      consolidatedResult.processingTime = totalTime;
      consolidatedResult.model = 'gemini-1.5-pro-split-pdf';
      consolidatedResult.method = 'file-api-split';
      
      this.logger.log(`✅ [PDF-SPLIT] Consolidación completada en ${totalTime}ms total`);
      
      return consolidatedResult;
      
    } catch (error) {
      this.logger.error(`❌ [PDF-SPLIT] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Divide un PDF en chunks de tamaño específico
   */
  private async splitPdfIntoChunks(pdfBuffer: Buffer, maxSizeMB: number): Promise<Buffer[]> {
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const totalPages = pdfDoc.getPageCount();
      
      this.logger.log(`📄 [PDF-SPLIT] PDF tiene ${totalPages} páginas total`);
      
      const chunks: Buffer[] = [];
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      
      let currentChunkPages: number[] = [];
      let estimatedSize = 0;
      const avgPageSize = pdfBuffer.length / totalPages; // Estimación del tamaño promedio por página
      
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        // Estimar si agregar esta página excedería el límite
        const newEstimatedSize = estimatedSize + avgPageSize;
        
        if (newEstimatedSize > maxSizeBytes && currentChunkPages.length > 0) {
          // Crear chunk con las páginas actuales
          const chunkBuffer = await this.createPdfChunk(pdfDoc, currentChunkPages);
          chunks.push(chunkBuffer);
          
          this.logger.log(`📦 [PDF-SPLIT] Chunk creado con páginas ${currentChunkPages[0] + 1}-${currentChunkPages[currentChunkPages.length - 1] + 1} (${(chunkBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
          
          // Reiniciar para el siguiente chunk
          currentChunkPages = [pageIndex];
          estimatedSize = avgPageSize;
        } else {
          currentChunkPages.push(pageIndex);
          estimatedSize = newEstimatedSize;
        }
      }
      
      // Agregar el último chunk si tiene páginas
      if (currentChunkPages.length > 0) {
        const chunkBuffer = await this.createPdfChunk(pdfDoc, currentChunkPages);
        chunks.push(chunkBuffer);
        
        this.logger.log(`📦 [PDF-SPLIT] Chunk final creado con páginas ${currentChunkPages[0] + 1}-${currentChunkPages[currentChunkPages.length - 1] + 1} (${(chunkBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
      }
      
      return chunks;
      
    } catch (error) {
      this.logger.error(`❌ [PDF-SPLIT] Error dividiendo PDF: ${error.message}`);
      throw error;
    }
  }

  /**
   * Crea un chunk de PDF con páginas específicas
   */
  private async createPdfChunk(sourcePdf: PDFDocument, pageIndices: number[]): Promise<Buffer> {
    const newPdf = await PDFDocument.create();
    
    for (const pageIndex of pageIndices) {
      const [copiedPage] = await newPdf.copyPages(sourcePdf, [pageIndex]);
      newPdf.addPage(copiedPage);
    }
    
    return Buffer.from(await newPdf.save());
  }

  /**
   * Consolida los resultados de múltiples chunks
   */
  private consolidateChunkResults(
    chunkResults: GeminiFileApiResult[],
    originalPrompt: string,
    expectedType: ResponseType
  ): GeminiFileApiResult {
    if (chunkResults.length === 0) {
      return {
        response: 'NOT_FOUND',
        confidence: 0,
        reasoning: 'No se pudieron procesar chunks',
        processingTime: 0,
        tokensUsed: 0,
        model: 'gemini-1.5-pro-split-pdf',
        method: 'file-api-split'
      };
    }

    // Consolidar respuestas
    const responses = chunkResults.map(r => r.response).filter(r => r && r !== 'NOT_FOUND');
    const totalTokens = chunkResults.reduce((sum, r) => sum + r.tokensUsed, 0);
    const avgConfidence = chunkResults.reduce((sum, r) => sum + r.confidence, 0) / chunkResults.length;
    
    let consolidatedResponse: string;
    
    if (responses.length === 0) {
      consolidatedResponse = 'NOT_FOUND';
    } else if (expectedType === ResponseType.TEXT) {
      // Para texto, combinar todas las respuestas relevantes
      consolidatedResponse = responses.join(' | ');
    } else {
      // Para otros tipos, tomar la primera respuesta válida
      consolidatedResponse = responses[0];
    }
    
    return {
      response: consolidatedResponse,
      confidence: Math.min(avgConfidence, 0.95), // Cap confidence for split processing
      reasoning: `Processed ${chunkResults.length} chunks, ${responses.length} contained relevant data`,
      processingTime: 0, // Se asignará luego
      tokensUsed: totalTokens,
      model: 'gemini-1.5-pro-split-pdf',
      method: 'file-api-split'
    };
  }
}