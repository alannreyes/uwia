
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { PdfProcessingSession } from './pdf-processing-session.entity';

@Entity('pdf_chunks')
@Index('idx_session_chunks', ['sessionId', 'chunkIndex'])
export class PdfChunk {
  @PrimaryColumn('varchar', { length: 50 })
  id: string;

  @Column('varchar', { length: 36 })
  sessionId: string;

  @ManyToOne(() => PdfProcessingSession, session => session.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: PdfProcessingSession;

  @Column('int')
  chunkIndex: number;

  @Column('longtext')
  content: string;

  @Column('varchar', { length: 64 })
  contentHash: string;

  @Column('int')
  chunkSize: number;

  @Column('int', { nullable: true })
  pageStart: number;

  @Column('int', { nullable: true })
  pageEnd: number;

  @Column('json', { nullable: true })
  keywords: any;

  @Column('text', { nullable: true })
  summary: string;

  @CreateDateColumn()
  createdAt: Date;
}
