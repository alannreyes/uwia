import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('claim_evaluations_gemini')
export class ClaimEvaluationGemini {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'claim_reference', length: 255 })
  @Index()
  claimReference: string;

  @Column({ name: 'document_name', length: 255 })
  @Index()
  documentName: string;

  // ID del prompt en document_consolidado
  @Column({ name: 'prompt_consolidado_id', type: 'int' })
  promptConsolidadoId: number;

  @Column('text')
  question: string;

  @Column('text', { nullable: true })
  response: string | null;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  confidence: number | null;

  @Column({ name: 'processing_time_ms', type: 'int', nullable: true })
  processingTimeMs: number | null;

  @CreateDateColumn({ name: 'created_at' })
  @Index()
  createdAt: Date;
}
