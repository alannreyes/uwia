import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { DocumentPrompt } from './document-prompt.entity';

@Entity('claim_evaluations')
export class ClaimEvaluation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'claim_reference', length: 255 })
  @Index()
  claimReference: string;

  @Column({ name: 'document_name', length: 255 })
  @Index()
  documentName: string;

  @Column({ name: 'prompt_id', nullable: true })
  promptId: number | null;

  @Column('text')
  question: string;

  @Column('text', { nullable: true })
  response: string;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  confidence: number;

  @Column({ name: 'validation_response', type: 'text', nullable: true })
  validationResponse: string;

  @Column({ name: 'validation_confidence', type: 'decimal', precision: 5, scale: 4, nullable: true })
  validationConfidence: number;

  @Column({ name: 'final_confidence', type: 'decimal', precision: 5, scale: 4, nullable: true })
  finalConfidence: number;

  @Column({ name: 'processing_time_ms', nullable: true })
  processingTimeMs: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn({ name: 'created_at' })
  @Index()
  createdAt: Date;

  @ManyToOne(() => DocumentPrompt, prompt => prompt.evaluations)
  @JoinColumn({ name: 'prompt_id' })
  prompt: DocumentPrompt;
}