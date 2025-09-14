import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('vector_queries')
@Index('idx_vector_queries_session', ['sessionId'])
@Index('idx_vector_queries_created', ['createdAt'])
export class VectorQuery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id', type: 'varchar', length: 36 })
  sessionId: string;

  @Column({ name: 'query_text', type: 'text' })
  queryText: string;

  @Column({ name: 'query_hash', type: 'varchar', length: 64 })
  queryHash: string;

  // Query embedding
  @Column({ name: 'query_embedding', type: 'json' })
  queryEmbedding: number[];

  @Column({ name: 'embedding_model', type: 'varchar', length: 50, default: 'text-embedding-3-large' })
  embeddingModel: string;

  // Search parameters
  @Column({ name: 'similarity_threshold', type: 'decimal', precision: 4, scale: 3, default: 0.7 })
  similarityThreshold: number;

  @Column({ name: 'max_results', type: 'int', default: 5 })
  maxResults: number;

  @Column({ 
    name: 'search_method', 
    type: 'enum',
    enum: ['semantic', 'hybrid', 'keyword'],
    default: 'hybrid'
  })
  searchMethod: 'semantic' | 'hybrid' | 'keyword';

  // Results
  @Column({ name: 'results_found', type: 'int' })
  resultsFound: number;

  @Column({ name: 'processing_time_ms', type: 'int' })
  processingTimeMs: number;

  @Column({ name: 'total_chunks_searched', type: 'int' })
  totalChunksSearched: number;

  // Retrieved chunks with similarities
  @Column({ name: 'retrieved_chunks', type: 'json' })
  retrievedChunks: {
    chunkId: string;
    similarity: number;
    rank: number;
    semanticType: string;
    importance: string;
  }[];

  // Final answer
  @Column({ name: 'generated_answer', type: 'longtext', nullable: true })
  generatedAnswer?: string;

  @Column({ name: 'answer_confidence', type: 'decimal', precision: 4, scale: 3, nullable: true })
  answerConfidence?: number;

  @Column({ name: 'llm_model_used', type: 'varchar', length: 50, nullable: true })
  llmModelUsed?: string;

  @Column({ name: 'total_tokens_used', type: 'int', nullable: true })
  totalTokensUsed?: number;

  // Performance metrics
  @Column({ name: 'cache_hit', type: 'boolean', default: false })
  cacheHit: boolean;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
