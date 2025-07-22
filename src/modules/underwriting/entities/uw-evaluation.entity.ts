import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UwDocument } from './uw-document.entity';

export enum ResponseType {
  BOOLEAN = 'boolean',
  DATE = 'date',
  TEXT = 'text',
  NUMBER = 'number',
  JSON = 'json'
}

@Entity('uw_evaluations')
export class UwEvaluation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  document_id: string;

  @ManyToOne(() => UwDocument, document => document.evaluations)
  @JoinColumn({ name: 'document_id' })
  document: UwDocument;

  @Column({ type: 'text' })
  prompt: string;

  @Column({
    type: 'enum',
    enum: ResponseType,
    default: ResponseType.TEXT
  })
  expected_type: ResponseType;

  @Column({ type: 'text', nullable: true })
  response: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  confidence: number;

  @Column({ type: 'text', nullable: true })
  validation_prompt: string;

  @Column({ type: 'text', nullable: true })
  validation_response: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  validation_confidence: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  final_confidence: number; // Promedio de confidence y validation_confidence

  @Column({ type: 'json', nullable: true })
  openai_metadata: any; // Para guardar info adicional de OpenAI

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}