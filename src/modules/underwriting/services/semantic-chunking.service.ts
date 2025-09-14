import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddingsService } from './openai-embeddings.service';
import { split } from 'sentence-splitter';
import * as crypto from 'crypto';

// --- Interfaces y Tipos ---
export interface SemanticChunk {
  id: string;
  sessionId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  characterCount: number;
  embedding?: number[];
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  pageStart?: number;
  pageEnd?: number;
  positionStart: number;
  positionEnd: number;
  semanticType: 'header' | 'content' | 'table' | 'list' | 'conclusion' | 'signature' | 'footer' | 'metadata';
  importance: 'critical' | 'high' | 'medium' | 'low';
  hasNumbers: boolean;
  hasDates: boolean;
  hasNames: boolean;
  hasMonetaryValues: boolean;
  keywords: string[];
}

export interface ChunkingOptions {
  strategy: 'semantic' | 'recursive';
  chunkSize?: number;
  overlap?: number;
  similarityThreshold?: number;
}

@Injectable()
export class SemanticChunkingService {
  private readonly logger = new Logger(SemanticChunkingService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly embeddingsService: OpenAIEmbeddingsService,
  ) {
    this.logger.log('🚀 Semantic Chunking Service initialized');
  }

  async chunkText(
    text: string,
    sessionId: string,
    options: ChunkingOptions = { strategy: 'semantic', similarityThreshold: 0.85 }
  ): Promise<SemanticChunk[]> {
    this.logger.log(`[${sessionId}] Starting chunking with strategy: ${options.strategy}`);
    if (options.strategy === 'semantic') {
      return this.semanticSplitter(text, sessionId, options.similarityThreshold);
    } else {
      return this.recursiveSplitter(text, sessionId, options.chunkSize, options.overlap);
    }
  }

  async chunkBySentenceMeanings(text: string): Promise<SemanticChunk[]> {
    return this.semanticSplitter(text, crypto.randomUUID(), 0.85);
  }

  async findSemanticBoundaries(sentences: string[]): Promise<number[]> {
    return [0, sentences.length];
  }

  async analyzeContentCoherence(chunks: string[]): Promise<number[]> {
    return chunks.map(() => 1);
  }

  async extractEntitiesAndKeywords(text: string): Promise<Partial<ChunkMetadata>> {
    return {
      hasNumbers: /\d/.test(text),
      hasDates: /(?:\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})|(?:\d{4})/.test(text),
      hasNames: /(?:[A-Z][a-z]+ ){1,2}[A-Z][a-z]+/.test(text),
      hasMonetaryValues: /[$€£]\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/.test(text),
      keywords: this.extractKeywords(text),
    };
  }

  private async semanticSplitter(
    text: string,
    sessionId: string,
    similarityThreshold: number = 0.85
  ): Promise<SemanticChunk[]> {
    
    // 1. Dividir el texto en oraciones
    const sentences = split(text)
      .filter(s => s.type === 'Sentence')
      .map(s => s.raw);

    if (sentences.length <= 1) {
      this.logger.log(`[${sessionId}] Only one sentence found, creating a single chunk.`);
      return [this.createChunkFromText(sentences[0] || text, sessionId, 0, 0, text.length -1)];
    }

    this.logger.log(`[${sessionId}] Text split into ${sentences.length} sentences.`);

    // 2. Generar embeddings para cada oración
    const { embeddings, errors } = await this.embeddingsService.embedBatch(sentences);
    if (errors.length > 0) {
      this.logger.warn(`[${sessionId}] ${errors.length} errors during sentence embedding.`);
    }

    // 3. Calcular la similitud entre oraciones consecutivas
    const similarities: number[] = [];
    for (let i = 0; i < embeddings.length - 1; i++) {
      const sim = this.embeddingsService.calculateCosineSimilarity(embeddings[i], embeddings[i+1]);
      similarities.push(sim);
    }

    // 4. Identificar los puntos de ruptura (donde la similitud cae)
    const breakpoints: number[] = [0]; // Siempre empezar un chunk con la primera oración
    for (let i = 0; i < similarities.length; i++) {
      if (similarities[i] < similarityThreshold) {
        breakpoints.push(i + 1); // El breakpoint es el inicio de la siguiente oración
        this.logger.debug(`[${sessionId}] Semantic break found at sentence ${i + 1} (similarity: ${similarities[i].toFixed(3)})`);
      }
    }
    if (breakpoints[breakpoints.length - 1] !== sentences.length) {
        breakpoints.push(sentences.length);
    }

    this.logger.log(`[${sessionId}] Found ${breakpoints.length - 1} potential chunks based on similarity threshold ${similarityThreshold}.`);

    // 5. Crear los chunks
    const chunks: SemanticChunk[] = [];
    let textPosition = 0;
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const startIdx = breakpoints[i];
      const endIdx = breakpoints[i+1];
      const chunkSentences = sentences.slice(startIdx, endIdx);
      const chunkText = chunkSentences.join(' ');
      
      const positionStart = text.indexOf(chunkSentences[0], textPosition);
      const positionEnd = positionStart + chunkText.length -1;
      textPosition = positionEnd;

      const chunk = this.createChunkFromText(chunkText, sessionId, i, positionStart, positionEnd);
      chunks.push(chunk);
    }

    this.logger.log(`[${sessionId}] ✅ Successfully created ${chunks.length} semantic chunks.`);
    return chunks;
  }

  /**
   * Estrategia de fallback: división recursiva por tamaño.
   */
  private recursiveSplitter(
    text: string,
    sessionId: string,
    chunkSize: number = 1000,
    overlap: number = 100
  ): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];
    let i = 0;
    let position = 0;
    while (position < text.length) {
      const start = position;
      const end = Math.min(position + chunkSize, text.length);
      const chunkText = text.substring(start, end);
      
      const chunk = this.createChunkFromText(chunkText, sessionId, i, start, end - 1);
      chunks.push(chunk);
      
      position += (chunkSize - overlap);
      i++;
    }
    this.logger.log(`[${sessionId}] Created ${chunks.length} chunks using recursive strategy.`);
    return chunks;
  }

  /**
   * Helper para crear un objeto SemanticChunk y sus metadatos.
   */
  private createChunkFromText(
    text: string,
    sessionId: string,
    index: number,
    positionStart: number,
    positionEnd: number
  ): SemanticChunk {
    const characterCount = text.length;
    const tokenCount = this.embeddingsService.estimateTokens(text);
    const contentHash = crypto.createHash('sha256').update(text).digest('hex');

    // Análisis básico de metadatos (se puede expandir con NLP)
    const metadata: ChunkMetadata = {
      positionStart,
      positionEnd,
      semanticType: this.detectSemanticType(text),
      importance: 'medium', // Placeholder, requeriría un modelo de clasificación
      hasNumbers: /\d/.test(text),
      hasDates: /(?:\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})|(?:\d{4})/.test(text), // Simplificado
      hasNames: /(?:[A-Z][a-z]+ ){1,2}[A-Z][a-z]+/.test(text), // Simplificado
      hasMonetaryValues: /[$€£]\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/.test(text),
      keywords: this.extractKeywords(text),
    };

    return {
      id: `${sessionId}-${index}-${contentHash.substring(0, 8)}`,
      sessionId,
      chunkIndex: index,
      content: text,
      contentHash,
      tokenCount,
      characterCount,
      metadata,
    };
  }

  /**
   * Detecta el tipo semántico de un chunk (lógica simplificada).
   */
  private detectSemanticType(text: string): ChunkMetadata['semanticType'] {
    const upperCaseRatio = (text.match(/[A-Z]/g) || []).length / text.length;
    if (upperCaseRatio > 0.5 && text.length < 100) return 'header';
    if (text.trim().startsWith('•') || /^\d+\./.test(text.trim())) return 'list';
    if (text.includes('signature') || text.includes('signed by')) return 'signature';
    return 'content';
  }

  /**
   * Extrae keywords simples de un texto.
   */
  private extractKeywords(text: string): string[] {
    // Lógica simple: palabras en mayúsculas o palabras comunes después de limpiar stopwords
    const stopWords = new Set(['a', 'an', 'the', 'in', 'on', 'is', 'of', 'for', 'to']);
    const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
    const keywordCounts = words.reduce((acc, word) => {
      if (word.length > 3 && !stopWords.has(word)) {
        acc[word] = (acc[word] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    // Devolver las 5 keywords más frecuentes
    return Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(entry => entry[0]);
  }

  /**
   * Convierte PdfChunks a SemanticChunks para uso en RAG
   */
  async convertChunksToSemantic(
    pdfChunks: any[], 
    sessionId: string, 
    filename: string
  ): Promise<SemanticChunk[]> {
    this.logger.log(`🔄 [SEMANTIC-CHUNKING] Converting ${pdfChunks.length} PDF chunks to semantic chunks`);
    this.logger.log(`📄 [SEMANTIC-CHUNKING] Session: ${sessionId}, File: ${filename}`);
    
    const semanticChunks: SemanticChunk[] = [];
    
    for (let i = 0; i < pdfChunks.length; i++) {
      const pdfChunk = pdfChunks[i];
      
      try {
        // Crear semantic chunk usando el método existente
        const semanticChunk = this.createChunkFromText(
          pdfChunk.content,
          sessionId,
          i,
          pdfChunk.pageStart || 0,
          pdfChunk.pageEnd || pdfChunk.content.length
        );
        
        // Enriquecer con información adicional del PdfChunk
        semanticChunk.metadata = {
          ...semanticChunk.metadata,
          pageStart: pdfChunk.pageStart,
          pageEnd: pdfChunk.pageEnd
        };
        
        semanticChunks.push(semanticChunk);
        
        this.logger.log(`   ✅ Converted chunk ${i + 1}/${pdfChunks.length}: ${pdfChunk.content.substring(0, 50)}...`);
        
      } catch (error) {
        this.logger.error(`   ❌ Failed to convert chunk ${i}: ${error.message}`);
        // Continue with other chunks
      }
    }
    
    this.logger.log(`✅ [SEMANTIC-CHUNKING] Successfully converted ${semanticChunks.length}/${pdfChunks.length} chunks`);
    
    return semanticChunks;
  }
}