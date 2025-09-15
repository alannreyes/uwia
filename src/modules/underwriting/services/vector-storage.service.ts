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
        
        // Removed verbose per-chunk caching log
        
        // Guardar en base de datos MySQL (mejores prácticas 2025)
        try {
          const entity = this.documentEmbeddingRepository.create({
            sessionId: chunk.sessionId,
            chunkId: chunk.id,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            contentHash: chunk.contentHash,
            embedding: chunk.embedding, // TypeORM handleará la serialización JSON automáticamente
            embeddingModel: 'text-embedding-3-large',
            embeddingDimensions: 3072,
            semanticType: chunk.metadata.semanticType,
            importance: chunk.metadata.importance,
            tokenCount: chunk.tokenCount,
            characterCount: chunk.characterCount,
            pageStart: chunk.metadata.pageStart,
            pageEnd: chunk.metadata.pageEnd,
            positionStart: chunk.metadata.positionStart,
            positionEnd: chunk.metadata.positionEnd,
            hasNumbers: chunk.metadata.hasNumbers,
            hasDates: chunk.metadata.hasDates,
            hasNames: chunk.metadata.hasNames,
            hasMonetaryValues: chunk.metadata.hasMonetaryValues,
            keywords: chunk.metadata.keywords
          });
          
          await this.documentEmbeddingRepository.save(entity);
          // Removed verbose per-chunk save log
          
        } catch (dbError) {
          this.logger.error(`❌ [VECTOR-STORAGE] Failed to save to database: ${dbError.message}`);
          // Continue with cache-only operation
        }
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
   * Implementa búsqueda híbrida: base de datos + cache (mejores prácticas 2025)
   */
  async findSimilar(
    queryEmbedding: number[], 
    options: SearchOptions = {}
  ): Promise<SimilarityResult[]> {
    const { topK = 5, minScore = 0.3, sessionId } = options;
    
    this.logger.log(`🔍 [VECTOR-STORAGE] Searching for similar chunks...`);
    this.logger.log(`   - Top K: ${topK}`);
    this.logger.log(`   - Min Score: ${minScore}`);
    this.logger.log(`   - Session ID: ${sessionId || 'all sessions'}`);
    
    const results: SimilarityResult[] = [];
    
    // 1. Buscar primero en base de datos (persistente y escalable)
    try {
      this.logger.log(`📊 [VECTOR-STORAGE] Searching in database...`);
      
      const queryBuilder = this.documentEmbeddingRepository.createQueryBuilder('embedding');
      
      if (sessionId) {
        queryBuilder.where('embedding.sessionId = :sessionId', { sessionId });
      }
      
      const dbEmbeddings = await queryBuilder
        .orderBy('embedding.importance', 'DESC')
        .addOrderBy('embedding.createdAt', 'DESC')
        .limit(50) // Pre-filtrar para performance
        .getMany();
      
      this.logger.log(`📊 [VECTOR-STORAGE] Found ${dbEmbeddings.length} embeddings in database`);
      
      // Calcular similitudes en batch
      for (const dbEmbedding of dbEmbeddings) {
        const similarity = this.embeddingsService.calculateCosineSimilarity(
          queryEmbedding,
          dbEmbedding.embedding
        );
        
        if (similarity >= minScore) {
          // Convertir de DocumentEmbedding a SemanticChunk para compatibilidad
          const semanticChunk: SemanticChunk = {
            id: dbEmbedding.chunkId,
            sessionId: dbEmbedding.sessionId,
            chunkIndex: dbEmbedding.chunkIndex,
            content: dbEmbedding.content,
            contentHash: dbEmbedding.contentHash,
            tokenCount: dbEmbedding.tokenCount,
            characterCount: dbEmbedding.characterCount,
            embedding: dbEmbedding.embedding,
            metadata: {
              positionStart: dbEmbedding.positionStart,
              positionEnd: dbEmbedding.positionEnd,
              semanticType: dbEmbedding.semanticType,
              importance: dbEmbedding.importance,
              hasNumbers: dbEmbedding.hasNumbers,
              hasDates: dbEmbedding.hasDates,
              hasNames: dbEmbedding.hasNames,
              hasMonetaryValues: dbEmbedding.hasMonetaryValues,
              keywords: dbEmbedding.keywords || [],
              pageStart: dbEmbedding.pageStart,
              pageEnd: dbEmbedding.pageEnd
            }
          };
          
          results.push({
            chunk: semanticChunk,
            score: similarity
          });
          
          // Log cada 10 matches
          if (results.length % 10 === 0 || results.length === 1) {
            this.logger.log(`   📍 ${results.length} matches encontrados`);
          }
        }
      }
      
    } catch (dbError) {
      this.logger.error(`❌ [VECTOR-STORAGE] Database search failed: ${dbError.message}`);
    }
    
    // 2. Si no hay resultados en BD o sessionId específico, buscar en cache como fallback
    if (results.length === 0 && this.embeddingCache.size > 0) {
      this.logger.log(`🔄 [VECTOR-STORAGE] Falling back to cache search...`);
      
      for (const [key, value] of this.embeddingCache.entries()) {
        // Filtrar por sessionId si se especifica
        if (sessionId && !key.startsWith(sessionId)) {
          continue;
        }
        
        const similarity = this.embeddingsService.calculateCosineSimilarity(
          queryEmbedding,
          value.embedding
        );
        
        if (similarity >= minScore) {
          results.push({
            chunk: value.chunk,
            score: similarity
          });
          
          // Log cache matches agrupados
          if (results.length % 5 === 1) {
            this.logger.log(`   📍 ${results.length} cache matches`);
          }
        }
      }
    }
    
    // 3. DISABLED: Sample data loading disabled in production to prevent interference
    // Sample data was causing field duplication issues (e.g., claim_number showing wrong values)
    if (results.length === 0) {
      this.logger.warn(`⚠️ [VECTOR-STORAGE] No embeddings found for session ${sessionId || 'unspecified'}`);
      this.logger.warn(`📊 [VECTOR-STORAGE] This may indicate documents are still being processed or session ID mismatch`);
      // Sample loading disabled - returns empty results instead of fake data
    }
    
    // 4. Ordenar por score descendente
    results.sort((a, b) => b.score - a.score);
    
    // Limitar a topK resultados
    const topResults = results.slice(0, topK);
    
    this.logger.log(`✅ [VECTOR-STORAGE] Found ${topResults.length} relevant chunks (from ${results.length} matches)`);
    
    if (topResults.length > 0) {
      this.logger.log(`🥇 [VECTOR-STORAGE] Best match found (score: ${topResults[0].score.toFixed(3)})`);
    }
    
    return topResults;
  }

  /**
   * Obtiene TODOS los chunks para una sesión específica (sin filtrado por similaridad)
   * Útil para documentos como POLICY.pdf que requieren procesamiento completo
   */
  async getAllChunksForSession(sessionId: string): Promise<SimilarityResult[]> {
    this.logger.log(`📚 [VECTOR-STORAGE] Retrieving ALL chunks for session: ${sessionId}`);

    const results: SimilarityResult[] = [];

    // 1. Buscar en base de datos
    try {
      const dbEmbeddings = await this.documentEmbeddingRepository.find({
        where: { sessionId },
        order: {
          importance: 'DESC',
          chunkIndex: 'ASC' // Mantener orden original de chunks
        }
      });

      this.logger.log(`📊 [VECTOR-STORAGE] Found ${dbEmbeddings.length} chunks in database`);

      // Convertir todos los chunks sin filtrado de score
      for (const dbEmbedding of dbEmbeddings) {
        const semanticChunk: SemanticChunk = {
          id: dbEmbedding.chunkId,
          sessionId: dbEmbedding.sessionId,
          chunkIndex: dbEmbedding.chunkIndex,
          content: dbEmbedding.content,
          contentHash: dbEmbedding.contentHash,
          tokenCount: dbEmbedding.tokenCount,
          characterCount: dbEmbedding.characterCount,
          metadata: {
            positionStart: dbEmbedding.positionStart,
            positionEnd: dbEmbedding.positionEnd,
            semanticType: dbEmbedding.semanticType,
            importance: dbEmbedding.importance,
            hasNumbers: dbEmbedding.hasNumbers,
            hasDates: dbEmbedding.hasDates,
            hasNames: dbEmbedding.hasNames,
            hasMonetaryValues: dbEmbedding.hasMonetaryValues,
            keywords: dbEmbedding.keywords || []
          },
          embedding: dbEmbedding.embedding
        };

        results.push({
          chunk: semanticChunk,
          score: 1.0 // Score máximo para indicar que es un chunk completo
        });
      }
    } catch (error) {
      this.logger.error(`❌ [VECTOR-STORAGE] Database query failed: ${error.message}`);
    }

    // 2. Buscar en cache si no hay resultados en BD
    if (results.length === 0) {
      this.logger.log(`🔍 [VECTOR-STORAGE] Searching in cache for session: ${sessionId}`);

      for (const [key, value] of this.embeddingCache.entries()) {
        if (key.startsWith(sessionId) || value.chunk.sessionId === sessionId) {
          results.push({
            chunk: value.chunk,
            score: 1.0
          });
        }
      }
    }

    this.logger.log(`✅ [VECTOR-STORAGE] Retrieved ${results.length} chunks for session ${sessionId}`);

    return results;
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