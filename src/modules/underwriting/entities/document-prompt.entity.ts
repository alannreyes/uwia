import { Entity, Column, PrimaryGeneratedColumn, Index, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ClaimEvaluation } from './claim-evaluation.entity';

@Entity('document_prompts')
@Index(['documentName', 'promptOrder'], { unique: true })
export class DocumentPrompt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'pmc_field', length: 255 })
  pmcField: string;

  @Column({ name: 'document_name', length: 255 })
  @Index()
  documentName: string;

  @Column({ name: 'prompt_order' })
  promptOrder: number;

  @Column('text')
  question: string;

  @Column({ name: 'expected_type', length: 20 })
  expectedType: string;

  @Column({ default: true })
  @Index()
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => ClaimEvaluation, evaluation => evaluation.prompt)
  evaluations: ClaimEvaluation[];
}