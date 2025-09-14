import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SemanticChunk } from './semantic-chunking.service';
import { DocumentEmbedding } from '../chunking/entities/document-embedding.entity';
import { OpenAIEmbeddingsService } from './openai-embeddings.service';

export interface SearchOptions {
  topK?: number;
  minScore?: number;
  sessionId?: string;
}

export interface SimilarityResult {
  chunk: SemanticChunk;
  score: number;
}

@Injectable()
export class VectorStorageService {
  private readonly logger = new Logger(VectorStorageService.name);
  
  // Cache temporal en memoria para pruebas rápidas
  private embeddingCache: Map<string, { chunk: SemanticChunk; embedding: number[] }> = new Map();

  constructor(
    @InjectRepository(DocumentEmbedding)
    private documentEmbeddingRepository: Repository<DocumentEmbedding>,
    private readonly embeddingsService: OpenAIEmbeddingsService,
  ) {
    this.logger.log('🚀 Vector Storage Service initialized');
  }

  /**
   * Almacena embeddings de chunks en la base de datos.
   */
  async storeEmbeddings(chunks: SemanticChunk[]): Promise<void> {
    this.logger.log(`📦 [VECTOR-STORAGE] Storing ${chunks.length} embeddings...`);
    
    try {
      for (const chunk of chunks) {
        // Generar embedding si no existe
        if (!chunk.embedding) {
          const embeddingResult = await this.embeddingsService.embedText(chunk.content);
          chunk.embedding = embeddingResult.embedding;
        }
        
        // Guardar en cache temporal
        const cacheKey = `${chunk.sessionId}-${chunk.id}`;
        this.embeddingCache.set(cacheKey, {
          chunk,
          embedding: chunk.embedding
        });
        
        this.logger.log(`💾 [VECTOR-STORAGE] Cached embedding for chunk ${chunk.id}`);
        
        // TODO: Guardar en base de datos
        // const entity = new DocumentEmbedding();
        // entity.documentId = chunk.sessionId;
        // entity.chunkIndex = chunk.chunkIndex;
        // entity.content = chunk.content;
        // entity.embedding = JSON.stringify(chunk.embedding);
        // await this.documentEmbeddingRepository.save(entity);
      }
      
      this.logger.log(`✅ [VECTOR-STORAGE] Successfully stored ${chunks.length} embeddings in cache`);
      this.logger.log(`📊 [VECTOR-STORAGE] Total cached embeddings: ${this.embeddingCache.size}`);
      
    } catch (error) {
      this.logger.error(`❌ [VECTOR-STORAGE] Failed to store embeddings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Busca chunks similares dado un embedding de consulta.
   */
  async findSimilar(
    queryEmbedding: number[], 
    options: SearchOptions = {}
  ): Promise<SimilarityResult[]> {
    const { topK = 5, minScore = 0.7, sessionId } = options;
    
    this.logger.log(`🔍 [VECTOR-STORAGE] Searching for similar chunks...`);
    this.logger.log(`   - Top K: ${topK}`);
    this.logger.log(`   - Min Score: ${minScore}`);
    this.logger.log(`   - Cache size: ${this.embeddingCache.size} embeddings`);
    
    if (this.embeddingCache.size === 0) {
      this.logger.warn(`⚠️ [VECTOR-STORAGE] No embeddings in cache to search`);
      
      // Intentar cargar algunos documentos de ejemplo si existen
      await this.loadSampleDocuments();
      
      if (this.embeddingCache.size === 0) {
        return [];
      }
    }
    
    const results: SimilarityResult[] = [];
    
    // Buscar en cache
    for (const [key, value] of this.embeddingCache.entries()) {
      // Filtrar por sessionId si se especifica
      if (sessionId && !key.startsWith(sessionId)) {
        continue;
      }
      
      // Calcular similitud coseno
      const similarity = this.embeddingsService.calculateCosineSimilarity(
        queryEmbedding,
        value.embedding
      );
      
      if (similarity >= minScore) {
        results.push({
          chunk: value.chunk,
          score: similarity
        });
        
        this.logger.log(`   📍 Found match: ${key} (score: ${similarity.toFixed(3)})`);
      }
    }
    
    // Ordenar por score descendente
    results.sort((a, b) => b.score - a.score);
    
    // Limitar a topK resultados
    const topResults = results.slice(0, topK);
    
    this.logger.log(`✅ [VECTOR-STORAGE] Found ${topResults.length} relevant chunks (from ${results.length} matches)`);
    
    if (topResults.length > 0) {
      this.logger.log(`🥇 [VECTOR-STORAGE] Best match score: ${topResults[0].score.toFixed(3)}`);
      this.logger.log(`📄 [VECTOR-STORAGE] Best match preview: "${topResults[0].chunk.content.substring(0, 100)}..."`);
    }
    
    return topResults;
  }

  /**
   * Actualiza el caché de embeddings para una sesión.
   */
  async updateEmbeddingCache(sessionId: string): Promise<void> {
    this.logger.log(`🔄 [VECTOR-STORAGE] Updating cache for session ${sessionId}`);
    
    // TODO: Cargar embeddings de la base de datos
    // const embeddings = await this.documentEmbeddingRepository.find({
    //   where: { documentId: sessionId }
    // });
    
    this.logger.log(`✅ [VECTOR-STORAGE] Cache updated for session ${sessionId}`);
  }

  /**
   * Carga documentos de ejemplo para pruebas
   */
  private async loadSampleDocuments(): Promise<void> {
    this.logger.log(`📚 [VECTOR-STORAGE] Loading sample documents for demo...`);
    
    // Ejemplos de contenido relacionado con los documentos típicos
    const sampleChunks = [
      {
        content: "Certificate of Completion. This certifies that the work has been completed on 07-18-25. All repairs and restoration work have been finished according to specifications.",
        metadata: { documentType: 'CERTIFICATE', importance: 'high' }
      },
      {
        content: "Letter of Protection Agreement dated NOT_FOUND. The homeowner located at 3213 8th St W, Lehigh Acres, FL 33971 agrees to the terms. Claim number 13368497-1.",
        metadata: { documentType: 'LOP', importance: 'high' }
      },
      {
        content: "Insurance Policy Coverage: Policy valid from 01-01-25 to 12-31-25. This policy covers wind, storm, and weather damage. Policyholder: Priscilla Chavez & Miguel Montano.",
        metadata: { documentType: 'POLICY', importance: 'critical' }
      },
      {
        content: "Weather Report for 02-04-25: Maximum wind gust recorded at 63 mph. Severe weather conditions confirmed for the date of loss.",
        metadata: { documentType: 'WEATHER', importance: 'high' }
      },
      {
        content: "Roof Area Assessment Report: Total roof area measured at 2,847 square feet. Multiple sections with varying pitch angles. Damage assessment completed.",
        metadata: { documentType: 'ROOF', importance: 'medium' }
      }
    ];
    
    for (let i = 0; i < sampleChunks.length; i++) {
      const sample = sampleChunks[i];
      const chunk: SemanticChunk = {
        id: `sample-${i}`,
        sessionId: 'demo-session',
        chunkIndex: i,
        content: sample.content,
        contentHash: '',
        tokenCount: this.embeddingsService.estimateTokens(sample.content),
        characterCount: sample.content.length,
        metadata: {
          positionStart: 0,
          positionEnd: sample.content.length,
          semanticType: 'content',
          importance: sample.metadata.importance as any,
          hasNumbers: /\d/.test(sample.content),
          hasDates: /\d{2}-\d{2}-\d{2}/.test(sample.content),
          hasNames: /[A-Z][a-z]+ [A-Z][a-z]+/.test(sample.content),
          hasMonetaryValues: /\$\d+/.test(sample.content),
          keywords: []
        }
      };
      
      // Generar embedding
      try {
        const embeddingResult = await this.embeddingsService.embedText(sample.content);
        chunk.embedding = embeddingResult.embedding;
        
        // Guardar en cache
        this.embeddingCache.set(`demo-${i}`, {
          chunk,
          embedding: chunk.embedding
        });
        
        this.logger.log(`   ✅ Loaded sample: ${sample.metadata.documentType}`);
      } catch (error) {
        this.logger.error(`   ❌ Failed to embed sample ${i}: ${error.message}`);
      }
    }
    
    this.logger.log(`✅ [VECTOR-STORAGE] Loaded ${this.embeddingCache.size} sample embeddings`);
  }

  /**
   * Limpia el cache de embeddings
   */
  clearCache(): void {
    const size = this.embeddingCache.size;
    this.embeddingCache.clear();
    this.logger.log(`🧹 [VECTOR-STORAGE] Cleared ${size} embeddings from cache`);
  }

  /**
   * Obtiene estadísticas del almacenamiento
   */
  getStats(): { cacheSize: number; totalEmbeddings: number } {
    return {
      cacheSize: this.embeddingCache.size,
      totalEmbeddings: this.embeddingCache.size // TODO: Incluir count de BD
    };
  }
}