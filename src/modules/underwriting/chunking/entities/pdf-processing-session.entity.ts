
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, OneToMany } from 'typeorm';
import { PdfChunk } from './pdf-chunk.entity';

export type ProcessingStatus = 'processing' | 'ready' | 'expired' | 'error';

@Entity('pdf_processing_sessions')
export class PdfProcessingSession {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column('varchar', { length: 255, name: 'file_name' })
  fileName: string;

  @Column('bigint', { name: 'file_size' })
  fileSize: number;

  @Column('int', { default: 0, name: 'total_chunks' })
  totalChunks: number;

  @Column('int', { default: 0, name: 'processed_chunks' })
  processedChunks: number;

  @Column({
    type: 'enum',
    enum: ['processing', 'ready', 'expired', 'error'],
    default: 'processing',
  })
  status: ProcessingStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Index('idx_status_expires')
  @Column('timestamp', { name: 'expires_at' })
  expiresAt: Date;

  @Column('json', { nullable: true })
  metadata: any;

  @OneToMany(() => PdfChunk, chunk => chunk.session)
  chunks: PdfChunk[];
}
