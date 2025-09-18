import { Injectable, Logger } from '@nestjs/common';
import { ResponseType } from '../entities/uw-evaluation.entity';
import { PDFDocument } from 'pdf-lib';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PdfProcessingSession } from '../chunking/entities/pdf-processing-session.entity';
import { VectorStorageService } from './vector-storage.service';
import { SemanticChunk } from './semantic-chunking.service';

interface DocumentChunk {
  content: string;
  pageNumbers: number[];
  chunkIndex: number;
  embedding?: number[];
  metadata?: any;
}

interface RAGSearchResult {
  chunk: DocumentChunk;
  similarity: number;
  relevanceScore: number;
}

export interface ModernRAGResult {
  response: string;
  confidence: number;
  reasoning?: string;
  processingTime: number;
  tokensUsed: number;
  model: string;
  method: 'modern-rag';
  usedChunks: number;
  totalChunks: number;
  relevantChunks: string[];
  sessionId?: string;
}

@Injectable()
export class ModernRAGService {
  private readonly logger = new Logger(ModernRAGService.name);
  private geminiClient?: any;
  private embedModel?: any;
  private generativeModel?: any;
  
  constructor(
    private readonly vectorStorage?: VectorStorageService,
    @InjectRepository(PdfProcessingSession)
    private readonly sessionRepository?: Repository<PdfProcessingSession>
  ) {
    this.initializeModernRAG();
  }

  /**
   * Limpieza explícita de recursos efímeros usados durante Modern RAG
   * Actualmente no persistimos nada en disco/DB, pero dejamos el hook preparado.
   */
  async cleanup(sessionId?: string): Promise<void> {
    try {
      // Si se pasó sessionId y hay repositorio, eliminamos la sesión para hacer cascade delete de embeddings
      if (sessionId && this.sessionRepository) {
        await this.sessionRepository.delete({ id: sessionId });
        this.logger.log(`🧹 [MODERN-RAG] Deleted session ${sessionId} (cascade removed embeddings)`);
      }
      return;
    } catch (e) {
      this.logger.warn(`⚠️ [MODERN-RAG] Cleanup warning: ${e.message}`);
    }
  }

  private initializeModernRAG(): void {
    const apiKey = process.env.GEMINI_API_KEY;
    const enabled = process.env.GEMINI_ENABLED === 'true';
    
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      this.logger.warn('🟡 Modern RAG está deshabilitado - API Key no válida');
      return;
    }
    
    if (!enabled) {
      this.logger.warn('🟡 Modern RAG está deshabilitado (GEMINI_ENABLED=false)');
      return;
    }

    try {
      this.geminiClient = new GoogleGenerativeAI(apiKey);
      // Usar modelo de embeddings de Gemini
      this.embedModel = this.geminiClient.getGenerativeModel({ model: 'text-embedding-004' });
      // Usar modelo generativo principal
      this.generativeModel = this.geminiClient.getGenerativeModel({ model: 'gemini-1.5-pro-latest' });
      
      this.logger.log('✅ Modern RAG inicializado correctamente');
    } catch (error) {
      this.logger.error(`❌ Error inicializando Modern RAG: ${error.message}`);
    }
  }

  /**
   * Procesa un PDF usando RAG moderno 2025
   */
  async processWithModernRAG(
    pdfBuffer: Buffer,
    question: string,
    expectedType: ResponseType = ResponseType.TEXT
  ): Promise<ModernRAGResult> {
    const startTime = Date.now();
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);
    
    this.logger.log(`🚀 [MODERN-RAG] Iniciando análisis RAG para PDF de ${fileSizeMB.toFixed(2)}MB`);
    
    try {
  // 1. Extraer y chunkar el documento
  const sessionId = crypto.randomUUID();
  const chunks = await this.extractAndChunkDocument(pdfBuffer);
      this.logger.log(`📄 [MODERN-RAG] Documento dividido en ${chunks.length} chunks semánticos`);
      
      // 2. Generar embeddings para todos los chunks
  await this.generateEmbeddings(chunks);

      // 2.5 Crear sesión (si hay repo) y persistir embeddings con metadatos de Gemini
      try {
        if (this.vectorStorage) {
          // Crear sesión para cumplir FK y permitir consultas posteriores
          if (this.sessionRepository) {
            const now = new Date();
            const ttlMs = 2 * 60 * 60 * 1000; // 2 horas
            const expires = new Date(now.getTime() + ttlMs);
            const session = this.sessionRepository.create({
              id: sessionId,
              fileName: 'gemini-modernrag.pdf',
              fileSize: pdfBuffer.length,
              totalChunks: chunks.length,
              processedChunks: chunks.length,
              status: 'ready',
              expiresAt: expires,
              metadata: { embeddingModel: 'text-embedding-004', embeddingDimensions: 768 }
            });
            await this.sessionRepository.save(session);
            this.logger.log(`🧾 [MODERN-RAG] Session created: ${sessionId} (ttl 2h)`);
          }

          // mapear chunks a SemanticChunk estructuralmente compatible
          const semanticChunks: SemanticChunk[] = chunks.map((c, idx) => ({
            id: `gem-${idx}`,
            sessionId,
            chunkIndex: idx,
            content: c.content,
            contentHash: '',
            tokenCount: c.content.length / 4,
            characterCount: c.content.length,
            embedding: c.embedding,
            metadata: {
              positionStart: 0,
              positionEnd: c.content.length,
              semanticType: 'content',
              importance: 'medium',
              hasNumbers: /\d/.test(c.content),
              hasDates: /\d{2}-\d{2}-\d{2,4}/.test(c.content),
              hasNames: /[A-Z][a-z]+ [A-Z][a-z]+/.test(c.content),
              hasMonetaryValues: /[$€£]\s?\d/.test(c.content),
              keywords: [],
              // metadatos de modelo
              ...( { embeddingModel: 'text-embedding-004', embeddingDimensions: 768 } as any )
            }
          }));
          await this.vectorStorage.storeEmbeddings(semanticChunks, { embeddingModel: 'text-embedding-004', embeddingDimensions: 768 });
          this.logger.log(`💾 [MODERN-RAG] Persisted ${semanticChunks.length} embeddings (Gemini 768D) for session ${sessionId}`);
        }
      } catch (persistErr) {
        this.logger.warn(`⚠️ [MODERN-RAG] Could not persist embeddings: ${persistErr.message}`);
      }
      this.logger.log(`🧠 [MODERN-RAG] Embeddings generados para ${chunks.length} chunks`);
      
      // 3. Generar embedding para la pregunta
      const questionEmbedding = await this.generateQuestionEmbedding(question);
      this.logger.log(`❓ [MODERN-RAG] Embedding generado para la pregunta`);
      
      // 4. Buscar chunks más relevantes usando similitud semántica
      const relevantChunks = this.findRelevantChunks(chunks, questionEmbedding, question);
      this.logger.log(`🎯 [MODERN-RAG] Encontrados ${relevantChunks.length} chunks relevantes`);
      
      // 5. Generar respuesta usando los chunks relevantes
  const response = await this.generateResponseFromChunks(relevantChunks, question, expectedType);
      
      const processingTime = Date.now() - startTime;
      
      this.logger.log(`✅ [MODERN-RAG] Completado en ${(processingTime / 1000).toFixed(2)}s`);
      
      return {
        response: response.text,
        confidence: response.confidence,
        reasoning: response.reasoning,
        processingTime,
        tokensUsed: response.tokensUsed,
        model: 'gemini-1.5-pro-modern-rag',
        method: 'modern-rag',
        usedChunks: relevantChunks.length,
        totalChunks: chunks.length,
        relevantChunks: relevantChunks.map(r => `Chunk ${r.chunk.chunkIndex} (pages ${r.chunk.pageNumbers.join(', ')})`),
        sessionId
      };
      
    } catch (error) {
      this.logger.error(`❌ [MODERN-RAG] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrae texto y crea chunks semánticos inteligentes
   */
  private async extractAndChunkDocument(pdfBuffer: Buffer): Promise<DocumentChunk[]> {
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const totalPages = pdfDoc.getPageCount();
      const chunks: DocumentChunk[] = [];
      
      // Estrategia: Chunks por página con contexto
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        try {
          // Para cada página, extraer texto usando OCR simulado o text extraction
          const pageText = await this.extractTextFromPage(pdfDoc, pageIndex);
          
          if (pageText && pageText.trim().length > 50) {
            chunks.push({
              content: pageText.trim(),
              pageNumbers: [pageIndex + 1],
              chunkIndex: chunks.length,
              metadata: {
                pageIndex,
                wordCount: pageText.split(' ').length,
                extractedAt: new Date().toISOString()
              }
            });
          }
        } catch (pageError) {
          this.logger.warn(`⚠️ [MODERN-RAG] Error extrayendo página ${pageIndex + 1}: ${pageError.message}`);
        }
      }
      
      // Si no hay suficiente texto, crear chunks por grupos de páginas
      if (chunks.length === 0) {
        this.logger.log(`🔧 [MODERN-RAG] Creando chunks por grupos de páginas (OCR simulation)`);
        const pagesPerChunk = Math.max(1, Math.floor(totalPages / 10));
        
        for (let i = 0; i < totalPages; i += pagesPerChunk) {
          const endPage = Math.min(i + pagesPerChunk, totalPages);
          const pageNumbers = Array.from({ length: endPage - i }, (_, idx) => i + idx + 1);
          
          chunks.push({
            content: `Document section covering pages ${pageNumbers[0]} to ${pageNumbers[pageNumbers.length - 1]}. This section contains policy information that may include coverage details, dates, names, exclusions, and other insurance-related content.`,
            pageNumbers,
            chunkIndex: chunks.length,
            metadata: {
              pageRange: `${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`,
              isSimulated: true
            }
          });
        }
      }
      
      return chunks;
      
    } catch (error) {
      this.logger.error(`❌ [MODERN-RAG] Error chunking document: ${error.message}`);
      throw error;
    }
  }

  /**
   * Simula extracción de texto de una página
   */
  private async extractTextFromPage(pdfDoc: PDFDocument, pageIndex: number): Promise<string> {
    // Esta es una simulación - en producción usarías OCR real
    return `Page ${pageIndex + 1} content: Insurance policy information including coverage details, dates, exclusions, and policyholder information.`;
  }

  /**
   * Genera embeddings para todos los chunks
   */
  private async generateEmbeddings(chunks: DocumentChunk[]): Promise<void> {
    const batchSize = 5; // Procesar en lotes para evitar rate limits
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
      
      await Promise.all(batch.map(async (chunk) => {
        try {
          const result = await this.embedModel.embedContent(chunk.content);
          chunk.embedding = result.embedding.values;
        } catch (error) {
          this.logger.warn(`⚠️ [MODERN-RAG] Error generando embedding para chunk ${chunk.chunkIndex}: ${error.message}`);
          // Embedding por defecto para chunks que fallan
          chunk.embedding = new Array(768).fill(0); // Dimensión típica de embeddings
        }
      }));
      
      // Pequeña pausa entre lotes
      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Genera embedding para la pregunta
   */
  private async generateQuestionEmbedding(question: string): Promise<number[]> {
    try {
      const result = await this.embedModel.embedContent(question);
      return result.embedding.values;
    } catch (error) {
      this.logger.error(`❌ [MODERN-RAG] Error generando embedding para pregunta: ${error.message}`);
      return new Array(768).fill(0);
    }
  }

  /**
   * Encuentra chunks más relevantes usando similitud coseno + heurísticas
   */
  private findRelevantChunks(
    chunks: DocumentChunk[],
    questionEmbedding: number[],
    question: string
  ): RAGSearchResult[] {
    const results: RAGSearchResult[] = [];
    
    // Extraer keywords de la pregunta para heurísticas
    const keywords = this.extractKeywords(question.toLowerCase());
    
    for (const chunk of chunks) {
      if (!chunk.embedding) continue;
      
      // 1. Similitud coseno
      const cosineSimilarity = this.calculateCosineSimilarity(questionEmbedding, chunk.embedding);
      
      // 2. Heurísticas basadas en contenido
      const keywordScore = this.calculateKeywordRelevance(chunk.content.toLowerCase(), keywords);
      
      // 3. Score final combinado
      const relevanceScore = (cosineSimilarity * 0.7) + (keywordScore * 0.3);
      
      results.push({
        chunk,
        similarity: cosineSimilarity,
        relevanceScore
      });
    }
    
    // Ordenar por relevancia y tomar los top chunks
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    // Tomar top 5 chunks más relevantes, pero al menos 2
    const topCount = Math.max(2, Math.min(5, Math.ceil(chunks.length * 0.3)));
    return results.slice(0, topCount);
  }

  /**
   * Extrae keywords importantes de la pregunta
   */
  private extractKeywords(question: string): string[] {
    const importantWords = question
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => 
        word.length > 3 && 
        !['this', 'that', 'with', 'from', 'they', 'have', 'were', 'been', 'their'].includes(word)
      );
    return importantWords;
  }

  /**
   * Calcula relevancia basada en keywords
   */
  private calculateKeywordRelevance(content: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    
    let score = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = content.match(regex);
      if (matches) {
        score += matches.length / keywords.length;
      }
    }
    
    return Math.min(score, 1.0);
  }

  /**
   * Calcula similitud coseno entre dos vectores
   */
  private calculateCosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Genera respuesta final usando chunks relevantes
   */
  private async generateResponseFromChunks(
    relevantChunks: RAGSearchResult[],
    question: string,
    expectedType: ResponseType
  ): Promise<{ text: string; confidence: number; reasoning?: string; tokensUsed: number }> {
    
    // Construir contexto con chunks relevantes
    const context = relevantChunks
      .map((result, index) => 
        `[Chunk ${index + 1} - Pages ${result.chunk.pageNumbers.join(', ')} - Relevance: ${result.relevanceScore.toFixed(2)}]\n${result.chunk.content}`
      )
      .join('\n\n');
    
    // Prompt optimizado para síntesis
    const synthesisPrompt = this.buildSynthesisPrompt(question, context, expectedType);
    
    try {
      const result = await this.generativeModel.generateContent(synthesisPrompt);
      const response = result.response;
      const text = response.text().trim();
      
      return {
        text,
        confidence: 0.9, // Alta confianza por RAG
        reasoning: `Synthesized from ${relevantChunks.length} relevant document chunks`,
        tokensUsed: response.usageMetadata?.totalTokenCount || 0
      };
      
    } catch (error) {
      this.logger.error(`❌ [MODERN-RAG] Error en síntesis: ${error.message}`);
      throw error;
    }
  }

  /**
   * Construye prompt de síntesis optimizado
   */
  private buildSynthesisPrompt(question: string, context: string, expectedType: ResponseType): string {
    let formatInstruction = '';
    
    switch (expectedType) {
      case ResponseType.TEXT:
        if (question.includes(';') || question.includes('semicolon')) {
          formatInstruction = 'Return your answer in the exact format specified, using semicolons as separators. Provide only the requested values in the specified order.';
        } else {
          formatInstruction = 'Provide a clear, concise answer based on the document content.';
        }
        break;
      case ResponseType.BOOLEAN:
        formatInstruction = 'Answer only YES or NO.';
        break;
      case ResponseType.NUMBER:
        formatInstruction = 'Return only the numeric value.';
        break;
      case ResponseType.DATE:
        formatInstruction = 'Return only the date in MM-DD-YY format.';
        break;
    }
    
    return `You are analyzing an insurance document. Use the following relevant document sections to answer the question precisely.

RELEVANT DOCUMENT SECTIONS:
${context}

QUESTION:
${question}

INSTRUCTIONS:
${formatInstruction}

Base your answer only on the information provided in the document sections above. If information is not found, use "NOT_FOUND" for missing values.

ANSWER:`;
  }

  /**
   * Verifica si el servicio está disponible
   */
  isAvailable(): boolean {
    return !!(this.geminiClient && this.embedModel && this.generativeModel);
  }
}