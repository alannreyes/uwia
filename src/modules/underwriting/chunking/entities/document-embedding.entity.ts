import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { PdfProcessingSession } from './pdf-processing-session.entity';

@Entity('document_embeddings')
@Index('idx_document_embeddings_session', ['sessionId'])
@Index('idx_document_embeddings_chunk', ['chunkId'])
@Index('idx_document_embeddings_semantic_type', ['semanticType'])
@Index('idx_document_embeddings_importance', ['importance'])
export class DocumentEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id', type: 'varchar', length: 36 })
  sessionId: string;

  @Column({ name: 'chunk_id', type: 'varchar', length: 100 })
  chunkId: string;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex: number;

  @Column({ name: 'content', type: 'longtext' })
  content: string;

  @Column({ name: 'content_hash', type: 'varchar', length: 64 })
  contentHash: string;

  // Embedding vector (3072 dimensions for text-embedding-3-large)
  @Column({ name: 'embedding', type: 'json' })
  embedding: number[];

  @Column({ name: 'embedding_model', type: 'varchar', length: 50, default: 'text-embedding-3-large' })
  embeddingModel: string;

  @Column({ name: 'embedding_dimensions', type: 'int', default: 3072 })
  embeddingDimensions: number;

  // Semantic metadata
  @Column({ 
    name: 'semantic_type', 
    type: 'enum', 
    enum: ['header', 'content', 'table', 'list', 'conclusion', 'signature', 'footer', 'metadata'],
    default: 'content'
  })
  semanticType: 'header' | 'content' | 'table' | 'list' | 'conclusion' | 'signature' | 'footer' | 'metadata';

  @Column({ 
    name: 'importance', 
    type: 'enum',
    enum: ['critical', 'high', 'medium', 'low'],
    default: 'medium'
  })
  importance: 'critical' | 'high' | 'medium' | 'low';

  @Column({ name: 'token_count', type: 'int' })
  tokenCount: number;

  @Column({ name: 'character_count', type: 'int' })
  characterCount: number;

  // Position metadata
  @Column({ name: 'page_start', type: 'int', nullable: true })
  pageStart?: number;

  @Column({ name: 'page_end', type: 'int', nullable: true })
  pageEnd?: number;

  @Column({ name: 'position_start', type: 'int' })
  positionStart: number;

  @Column({ name: 'position_end', type: 'int' })
  positionEnd: number;

  // Content analysis
  @Column({ name: 'has_numbers', type: 'boolean', default: false })
  hasNumbers: boolean;

  @Column({ name: 'has_dates', type: 'boolean', default: false })
  hasDates: boolean;

  @Column({ name: 'has_names', type: 'boolean', default: false })
  hasNames: boolean;

  @Column({ name: 'has_addresses', type: 'boolean', default: false })
  hasAddresses: boolean;

  @Column({ name: 'has_monetary_values', type: 'boolean', default: false })
  hasMonetaryValues: boolean;

  @Column({ name: 'has_legal_terms', type: 'boolean', default: false })
  hasLegalTerms: boolean;

  // Named entities (JSON array)
  @Column({ name: 'entities', type: 'json', nullable: true })
  entities?: {
    type: 'PERSON' | 'ORG' | 'MONEY' | 'DATE' | 'ADDRESS' | 'POLICY_NUMBER' | 'CLAIM_NUMBER';
    value: string;
    confidence: number;
  }[];

  // Keywords for hybrid search
  @Column({ name: 'keywords', type: 'json', nullable: true })
  keywords?: string[];

  // Similarity metadata (for later use)
  @Column({ name: 'similar_chunks', type: 'json', nullable: true })
  similarChunks?: {
    chunkId: string;
    similarity: number;
  }[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relación con la sesión
  @ManyToOne(() => PdfProcessingSession, session => session.id)
  @JoinColumn({ name: 'session_id' })
  session: PdfProcessingSession;
}
