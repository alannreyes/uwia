import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

// Fixed mapping to legacy prompts table used by FK in claim_evaluations
@Entity('document_prompts')
export class LegacyDocumentPrompt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'pmc_field', length: 255, nullable: true })
  pmcField?: string;

  @Column({ name: 'document_name', length: 255 })
  @Index()
  documentName: string;

  @Column({ name: 'prompt_order', nullable: true })
  promptOrder?: number;
}
