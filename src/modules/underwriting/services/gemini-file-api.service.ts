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
  method: 'inline' | 'file-api' | 'file-api-split' | 'modern-rag' | 'file-api-direct' | 'inline-api-direct';
}

@Injectable()
export class GeminiFileApiService {
  private readonly logger = new Logger(GeminiFileApiService.name);
  private geminiClient?: any;
  private fileManager?: any;
  private model?: any;
  
  // Official thresholds based on Google Gemini API 2025 documentation for PDFs
  // 0-20MB: Inline base64 API processing (Google official recommendation)
  // 20MB-50MB: Files API for PDFs (Google official PDF limit)
  // >50MB: Requires page-based splitting (exceeds Files API PDF limit)
  private readonly INLINE_API_THRESHOLD_MB = 20;
  private readonly INLINE_API_THRESHOLD_BYTES = this.INLINE_API_THRESHOLD_MB * 1024 * 1024;

  private readonly FILES_API_PDF_LIMIT_MB = 50; // Google official PDF limit for Files API
  private readonly FILES_API_PDF_LIMIT_BYTES = this.FILES_API_PDF_LIMIT_MB * 1024 * 1024;

  private readonly MAX_PAGES = 1000; // Google enforced page limit
  
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
      this.logger.log(`📏 Official Google PDF Thresholds: <${this.INLINE_API_THRESHOLD_MB}MB (Inline) | ${this.INLINE_API_THRESHOLD_MB}-${this.FILES_API_PDF_LIMIT_MB}MB (Files API) | >${this.FILES_API_PDF_LIMIT_MB}MB (Split) | Max ${this.MAX_PAGES} pages`);
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
      // Optimized decision flow based on proven performance testing
      if (pdfBuffer.length < this.INLINE_API_THRESHOLD_BYTES) {
        // Small files < 20MB: Use inline API per Google recommendations
        this.logger.log(`📝 Archivo pequeño (${fileSizeMB.toFixed(2)}MB) - usando Inline API (Google oficial <20MB)`);
        return await this.processWithInlineApi(pdfBuffer, prompt, expectedType, startTime);
      } else if (pdfBuffer.length <= this.FILES_API_PDF_LIMIT_BYTES) {
        // Files 20MB-50MB: Use Files API per Google official PDF limit
        this.logger.log(`🚀 Archivo mediano (${fileSizeMB.toFixed(2)}MB) - usando Files API (Google oficial PDF limit 50MB)`);
        return await this.processFileDirectly(pdfBuffer, prompt, expectedType, startTime);
      } else {
        // Files > 50MB: Exceeds Google Files API PDF limit, use page splitting
        this.logger.log(`📚 Archivo grande (${fileSizeMB.toFixed(2)}MB) - excede límite Files API (50MB), usando page splitting`);
        return await this.processWithPageBasedSplitting(pdfBuffer, prompt, expectedType, startTime);
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
    this.logger.log(`🧠 [MODERN-RAG] Iniciando Modern RAG para ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    try {
      if (!this.modernRAGService.isAvailable()) {
        this.logger.warn(`⚠️ [MODERN-RAG] Modern RAG no disponible, fallback a Page-based Splitting`);
        return await this.processWithPageBasedSplitting(pdfBuffer, prompt, expectedType, startTime);
      }

      this.logger.log(`✅ [MODERN-RAG] Modern RAG disponible, iniciando procesamiento...`);

      const ragResult: ModernRAGResult = await this.modernRAGService.processWithModernRAG(
        pdfBuffer,
        prompt,
        expectedType
      );

      this.logger.log(`🎯 [MODERN-RAG] Resultado obtenido: ${ragResult.response?.substring(0, 100)}...`);
      this.logger.log(`📊 [MODERN-RAG] Chunks: ${ragResult.usedChunks}/${ragResult.totalChunks}, Confianza: ${ragResult.confidence}`);

      // Convertir resultado de Modern RAG a formato GeminiFileApiResult
      const result: GeminiFileApiResult = {
        response: ragResult.response,
        confidence: ragResult.confidence,
        reasoning: `${ragResult.reasoning} | Used ${ragResult.usedChunks}/${ragResult.totalChunks} chunks`,
        processingTime: ragResult.processingTime,
        tokensUsed: ragResult.tokensUsed,
        model: ragResult.model,
        method: 'modern-rag'
      };

      // Limpieza explícita tras terminar
      try {
        await this.modernRAGService.cleanup(ragResult.sessionId);
        this.logger.log(`🧹 [MODERN-RAG] Sesión ${ragResult.sessionId} limpiada correctamente`);
      } catch (cleanupErr) {
        this.logger.warn(`⚠️ [MODERN-RAG] Cleanup failed: ${cleanupErr.message}`);
      }

      this.logger.log(`✅ [MODERN-RAG] Procesamiento completado exitosamente en ${ragResult.processingTime}ms`);
      return result;

    } catch (error) {
      this.logger.error(`❌ [MODERN-RAG] Error completo: ${error.message}`);
      this.logger.error(`❌ [MODERN-RAG] Stack trace: ${error.stack}`);
      this.logger.warn(`🔄 [MODERN-RAG] Fallback a Page-based Splitting...`);

      return await this.processWithPageBasedSplitting(pdfBuffer, prompt, expectedType, startTime);
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
  getThresholdInfo(): { inlineMB: number; filesApiPdfLimitMB: number; maxPages: number; inlineBytes: number; filesApiPdfLimitBytes: number } {
    return {
      inlineMB: this.INLINE_API_THRESHOLD_MB,
      filesApiPdfLimitMB: this.FILES_API_PDF_LIMIT_MB,
      maxPages: this.MAX_PAGES,
      inlineBytes: this.INLINE_API_THRESHOLD_BYTES,
      filesApiPdfLimitBytes: this.FILES_API_PDF_LIMIT_BYTES
    };
  }

  /**
   * Procesa PDFs grandes usando división inteligente optimizada para Google AI
   */
  async processWithSmartSplitting(
    pdfBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType,
    startTime: number
  ): Promise<GeminiFileApiResult> {
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);
    this.logger.log(`🔪 [SMART-SPLIT] ============= INICIANDO SMART SPLITTING =============`);
    this.logger.log(`🔪 [SMART-SPLIT] Archivo: ${fileSizeMB.toFixed(2)}MB`);
    this.logger.log(`🔪 [SMART-SPLIT] Prompt length: ${prompt.length} chars`);
    this.logger.log(`🔪 [SMART-SPLIT] Expected type: ${expectedType}`);

    try {
      // 1. Analizar PDF para determinar estrategia óptima
      this.logger.log(`📋 [SMART-SPLIT] Cargando PDF con pdf-lib...`);
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const totalPages = pdfDoc.getPageCount();

      this.logger.log(`📄 [SMART-SPLIT] PDF cargado exitosamente: ${totalPages} páginas`);

      // 2. Determinar si dividir por páginas (siguiendo límite de Google de 1000 páginas)
      if (totalPages > 900) { // Margen de seguridad bajo el límite de 1000
        this.logger.log(`📚 [SMART-SPLIT] PDF muy extenso (${totalPages} páginas) - dividiendo por secciones de páginas`);
        return await this.processWithPageBasedSplitting(pdfBuffer, prompt, expectedType, startTime);
      } else {
        this.logger.log(`📄 [SMART-SPLIT] PDF manejable (${totalPages} páginas) - dividiendo por tamaño optimizado`);
        return await this.processWithSizeBasedSplitting(pdfBuffer, prompt, expectedType, startTime);
      }

    } catch (error) {
      this.logger.error(`❌ [SMART-SPLIT] Error crítico: ${error.message}`);
      this.logger.error(`❌ [SMART-SPLIT] Stack trace: ${error.stack}`);

      // Generar respuesta de fallback en formato correcto
      this.logger.warn(`🆘 [SMART-SPLIT] Generando respuesta de fallback...`);
      const fallbackResponse = this.generateNotFoundResponse(prompt);

      return {
        response: fallbackResponse,
        confidence: 0.1,
        reasoning: `Smart splitting failed: ${error.message}`,
        processingTime: Date.now() - startTime,
        tokensUsed: 0,
        model: 'fallback-error',
        method: 'file-api-split'
      };
    }
  }

  /**
   * División basada en páginas para PDFs muy extensos
   */
  private async processWithPageBasedSplitting(
    pdfBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType,
    startTime: number
  ): Promise<GeminiFileApiResult> {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = pdfDoc.getPageCount();
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);

    // Calcular páginas por chunk dinámicamente para mantener chunks bajo 40MB
    // Estimación conservadora: si 92MB = 24 páginas, entonces ~4MB por página
    const avgMBPerPage = fileSizeMB / totalPages;
    const targetChunkSizeMB = 35; // Objetivo conservador para evitar límites
    const pagesPerChunk = Math.max(1, Math.floor(targetChunkSizeMB / avgMBPerPage));

    this.logger.log(`📑 [PAGE-SPLIT] Dividiendo ${totalPages} páginas en chunks de ~${pagesPerChunk} páginas (${avgMBPerPage.toFixed(2)}MB/página)`);
    this.logger.log(`📊 [PAGE-SPLIT] Target: ${targetChunkSizeMB}MB por chunk para archivo de ${fileSizeMB.toFixed(2)}MB`);

    const chunkResults: GeminiFileApiResult[] = [];

    for (let startPage = 0; startPage < totalPages; startPage += pagesPerChunk) {
      const endPage = Math.min(startPage + pagesPerChunk - 1, totalPages - 1);
      const pageRange = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);

      this.logger.log(`📄 [PAGE-SPLIT] Procesando páginas ${startPage + 1}-${endPage + 1}/${totalPages}`);

      try {
        const chunkBuffer = await this.createPdfChunk(pdfDoc, pageRange);
        const chunkSizeMB = chunkBuffer.length / (1024 * 1024);

        this.logger.log(`📦 [PAGE-SPLIT] Chunk creado: ${chunkSizeMB.toFixed(2)}MB`);

        // Validar que el chunk no exceda límites de Gemini (45MB conservador)
        if (chunkSizeMB > 45) {
          this.logger.warn(`⚠️ [PAGE-SPLIT] Chunk ${chunkSizeMB.toFixed(2)}MB excede límite, usando Inline API`);
          const chunkResult = await this.processWithInlineApi(chunkBuffer, prompt, expectedType, Date.now());
          chunkResult.method = 'inline-api-direct';
          chunkResults.push(chunkResult);
        } else {
          // Procesar chunk sin recursión para evitar loops infinitos
          const chunkResult = await this.processChunkDirectly(chunkBuffer, prompt, expectedType, startPage + 1, endPage + 1);
          chunkResults.push(chunkResult);
        }

      } catch (chunkError) {
        this.logger.error(`❌ [PAGE-SPLIT] Error procesando páginas ${startPage + 1}-${endPage + 1}: ${chunkError.message}`);
      }
    }

    // Consolidar resultados de manera inteligente para POLICY.pdf
    const consolidatedResult = this.smartConsolidateResults(chunkResults, prompt, expectedType);
    consolidatedResult.processingTime = Date.now() - startTime;
    consolidatedResult.model = 'gemini-1.5-pro-page-split';
    consolidatedResult.method = 'file-api-split';

    return consolidatedResult;
  }

  /**
   * División basada en tamaño para PDFs grandes pero manejables
   */
  private async processWithSizeBasedSplitting(
    pdfBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType,
    startTime: number
  ): Promise<GeminiFileApiResult> {
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);

    // Bypass splitting for files under 100MB - Gemini File API supports up to 2GB
    // This avoids the pdf-lib bug that causes massive size inflation when copying pages
    if (fileSizeMB <= 100) {
      this.logger.log(`📄 [BYPASS-SPLIT] Archivo de ${fileSizeMB.toFixed(2)}MB - enviando directamente a Gemini (sin split)`);

      try {
        const response = await this.processFileDirectly(pdfBuffer, prompt, expectedType, startTime);
        this.logger.log(`✅ [BYPASS-SPLIT] Procesamiento directo exitoso`);
        return response;
      } catch (error) {
        this.logger.warn(`⚠️ [BYPASS-SPLIT] Fallo procesamiento directo: ${error.message}`);
        this.logger.log(`🔄 [BYPASS-SPLIT] Fallback a splitting por páginas`);
        // Fallback to page-based splitting if direct processing fails
      }
    }

    // Original splitting logic for very large files or when direct processing fails
    // Dividir en chunks de 5MB para evitar límites de Gemini File API
    // Nota: Gemini tiene límites muy estrictos - reducido de 15MB a 10MB y ahora a 5MB
    // debido a errores "files bytes are too large to be read"
    const pdfChunks = await this.splitPdfIntoChunks(pdfBuffer, 5);

    this.logger.log(`📦 [SIZE-SPLIT] PDF dividido en ${pdfChunks.length} chunks de ~5MB`);

    const chunkResults: GeminiFileApiResult[] = [];

    for (let i = 0; i < pdfChunks.length; i++) {
      const chunk = pdfChunks[i];
      const chunkSizeMB = chunk.length / (1024 * 1024);

      this.logger.log(`🔄 [SIZE-SPLIT] Procesando chunk ${i + 1}/${pdfChunks.length} (${chunkSizeMB.toFixed(2)}MB)`);

      try {
        const chunkResult = await this.processChunkDirectly(chunk, prompt, expectedType, 0, 0);
        chunkResults.push(chunkResult);

      } catch (chunkError) {
        this.logger.error(`❌ [SIZE-SPLIT] Error en chunk ${i + 1}: ${chunkError.message}`);
      }
    }

    const consolidatedResult = this.smartConsolidateResults(chunkResults, prompt, expectedType);
    consolidatedResult.processingTime = Date.now() - startTime;
    consolidatedResult.model = 'gemini-1.5-pro-size-split';
    consolidatedResult.method = 'file-api-split';

    return consolidatedResult;
  }

  /**
   * Procesa un archivo completo directamente sin división en chunks
   */
  private async processFileDirectly(
    fileBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType,
    startTime: number
  ): Promise<GeminiFileApiResult> {
    const fileSizeMB = fileBuffer.length / (1024 * 1024);

    this.logger.log(`📄 [DIRECT] Procesando archivo completo de ${fileSizeMB.toFixed(2)}MB directamente`);

    // Always use File API for direct processing (files are already 20MB+ when this method is called)
    if (fileSizeMB > this.INLINE_API_THRESHOLD_MB) {
      try {
        const result = await this.processWithFileApi(fileBuffer, prompt, expectedType, startTime);
        result.model = 'gemini-1.5-pro-direct';
        result.method = 'file-api-direct';
        return result;
      } catch (error) {
        this.logger.warn(`⚠️ [DIRECT] File API failed for ${fileSizeMB.toFixed(2)}MB file: ${error.message}`);
        this.logger.log(`🔄 [DIRECT] Falling back to page-based splitting`);
        // Fallback to page-based splitting for large files that fail File API
        return await this.processWithPageBasedSplitting(fileBuffer, prompt, expectedType, startTime);
      }
    } else {
      const result = await this.processWithInlineApi(fileBuffer, prompt, expectedType, startTime);
      result.model = 'gemini-1.5-pro-direct';
      result.method = 'inline-api-direct';
      return result;
    }
  }

  /**
   * Procesa un chunk directamente sin recursión
   */
  private async processChunkDirectly(
    chunkBuffer: Buffer,
    prompt: string,
    expectedType: ResponseType,
    startPage: number,
    endPage: number
  ): Promise<GeminiFileApiResult> {
    const chunkSizeMB = chunkBuffer.length / (1024 * 1024);
    const pageInfo = startPage > 0 ? ` (páginas ${startPage}-${endPage})` : '';

    // Use File API for larger chunks, Inline for smaller ones
    if (chunkSizeMB > this.INLINE_API_THRESHOLD_MB) {
      return await this.processWithFileApi(chunkBuffer, `${prompt}${pageInfo}`, expectedType, Date.now());
    } else {
      return await this.processWithInlineApi(chunkBuffer, `${prompt}${pageInfo}`, expectedType, Date.now());
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

          const chunkSizeMB = chunkBuffer.length / (1024 * 1024);
          this.logger.log(`📦 [PDF-SPLIT] Chunk creado con páginas ${currentChunkPages[0] + 1}-${currentChunkPages[currentChunkPages.length - 1] + 1} (${chunkSizeMB.toFixed(2)}MB)`);
          
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

        const chunkSizeMB = chunkBuffer.length / (1024 * 1024);
        this.logger.log(`📦 [PDF-SPLIT] Chunk final creado con páginas ${currentChunkPages[0] + 1}-${currentChunkPages[currentChunkPages.length - 1] + 1} (${chunkSizeMB.toFixed(2)}MB)`);
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
   * Consolida los resultados de múltiples chunks de manera inteligente
   */
  private smartConsolidateResults(
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

    const responses = chunkResults.map(r => r.response).filter(r => r && r !== 'NOT_FOUND');
    const totalTokens = chunkResults.reduce((sum, r) => sum + r.tokensUsed, 0);
    const avgConfidence = chunkResults.reduce((sum, r) => sum + r.confidence, 0) / chunkResults.length;

    let consolidatedResponse: string;

    if (responses.length === 0) {
      // Si ningún chunk encontró datos, generar respuesta con NOT_FOUND
      consolidatedResponse = this.generateNotFoundResponse(originalPrompt);
    } else {
      // Consolidación inteligente basada en el tipo de documento
      consolidatedResponse = this.mergeChunkResponses(responses, originalPrompt, expectedType);
    }

    return {
      response: consolidatedResponse,
      confidence: Math.min(avgConfidence, 0.95),
      reasoning: `Smart consolidation: ${chunkResults.length} chunks processed, ${responses.length} with data`,
      processingTime: 0,
      tokensUsed: totalTokens,
      model: 'gemini-1.5-pro-smart-split',
      method: 'file-api-split'
    };
  }

  /**
   * Genera una respuesta NOT_FOUND con el formato correcto según el prompt
   */
  private generateNotFoundResponse(prompt: string): string {
    // Para POLICY.pdf, generar respuesta con 7 campos
    if (prompt.includes('policy_valid_from1') || prompt.includes('Extract the following 7 data points')) {
      return 'NOT_FOUND;NOT_FOUND;NO;NO;NO;NOT_FOUND;NO';
    }

    // Para LOP.pdf, generar respuesta con 18 campos
    if (prompt.includes('mechanics_lien') || prompt.includes('Extract the following 18 data points')) {
      return 'NO;NOT_FOUND;NO;NO;NOT_FOUND;NOT_FOUND;NOT_FOUND;NOT_FOUND;NOT_FOUND;NOT_FOUND;NOT_FOUND;NO;NO;NO;NO;NO;NO;NO';
    }

    // Para otros documentos, respuesta simple
    return 'NOT_FOUND';
  }

  /**
   * Combina respuestas de chunks de manera inteligente
   */
  private mergeChunkResponses(responses: string[], prompt: string, expectedType: ResponseType): string {
    if (expectedType !== ResponseType.TEXT || !responses[0].includes(';')) {
      // Para respuestas simples, tomar la mejor
      return responses[0];
    }

    // Para respuestas con formato semicolon (POLICY.pdf, LOP.pdf)
    const mergedFields = this.mergeFieldBasedResponses(responses, prompt);
    return mergedFields;
  }

  /**
   * Combina respuestas basadas en campos separados por semicolon
   */
  private mergeFieldBasedResponses(responses: string[], prompt: string): string {
    // Determinar número de campos esperados
    let expectedFieldCount = 1;
    let documentType = 'UNKNOWN';
    if (prompt.includes('Extract the following 7 data points')) {
      expectedFieldCount = 7;
      documentType = 'POLICY';
    } else if (prompt.includes('Extract the following 18 data points')) {
      expectedFieldCount = 18;
      documentType = 'LOP';
    }

    this.logger.log(`📊 [CONSOLIDATION] Merging ${responses.length} responses for ${documentType} with ${expectedFieldCount} fields`);

    // Dividir todas las respuestas en campos
    const allFields: string[][] = responses.map(resp => resp.split(';'));

    // Crear array de mejores valores para cada campo
    const mergedFields: string[] = [];

    for (let fieldIndex = 0; fieldIndex < expectedFieldCount; fieldIndex++) {
      const fieldValues = allFields
        .map(fields => fields[fieldIndex] || 'NOT_FOUND')
        .filter(value => value && value.trim() !== '');

      // Logging para campos problemáticos de POLICY
      if (documentType === 'POLICY' && (fieldIndex === 4 || fieldIndex === 6)) {
        const fieldName = fieldIndex === 4 ? 'policy_covers_type_job' : 'policy_covers_dol';
        this.logger.log(`🔍 [CONSOLIDATION] Field ${fieldIndex + 1} (${fieldName}) values from chunks: ${JSON.stringify(fieldValues)}`);
      }

      // Priorizar valores que no sean NOT_FOUND, NO, o vacíos
      const bestValue = this.selectBestFieldValue(fieldValues);

      if (documentType === 'POLICY' && (fieldIndex === 4 || fieldIndex === 6)) {
        const fieldName = fieldIndex === 4 ? 'policy_covers_type_job' : 'policy_covers_dol';
        this.logger.log(`✅ [CONSOLIDATION] Field ${fieldIndex + 1} (${fieldName}) selected: "${bestValue}"`);
      }

      mergedFields.push(bestValue);
    }

    return mergedFields.join(';');
  }

  /**
   * Selecciona el mejor valor para un campo específico
   */
  private selectBestFieldValue(values: string[]): string {
    if (!values || values.length === 0) {
      return 'NOT_FOUND';
    }

    // Para campos YES/NO, si algún chunk dice YES, tomar YES
    // Esto es crítico para policy_covers_type_job y policy_covers_dol
    const hasYes = values.some(v => v && v.trim().toUpperCase() === 'YES');
    const hasNo = values.some(v => v && v.trim().toUpperCase() === 'NO');

    if (hasYes && hasNo) {
      // Si hay conflicto entre YES y NO, priorizar YES
      // Ya que diferentes páginas pueden tener información parcial
      return 'YES';
    }

    // Prioridad normal: valores con datos > YES > NO > NOT_FOUND
    const prioritizedValues = values.sort((a, b) => {
      const scoreA = this.getFieldValueScore(a);
      const scoreB = this.getFieldValueScore(b);
      return scoreB - scoreA; // Orden descendente
    });

    return prioritizedValues[0];
  }

  /**
   * Asigna puntuación a valores de campo para priorización
   */
  private getFieldValueScore(value: string): number {
    if (!value || value.trim() === '') return 0;

    const trimmedValue = value.trim().toUpperCase();

    // Valores con datos reales tienen la mayor prioridad
    if (trimmedValue !== 'NOT_FOUND' && trimmedValue !== 'NO' && trimmedValue !== 'YES') {
      return 100;
    }

    // YES tiene mayor prioridad que NO
    if (trimmedValue === 'YES') return 80;
    if (trimmedValue === 'NO') return 60;

    // NOT_FOUND tiene la menor prioridad
    if (trimmedValue === 'NOT_FOUND') return 10;

    return 50; // Valor por defecto
  }
}