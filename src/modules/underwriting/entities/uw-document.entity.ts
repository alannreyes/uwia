import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { UwClaim } from './uw-claim.entity';
import { UwEvaluation } from './uw-evaluation.entity';

@Entity('uw_documents')
export class UwDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  claim_id: string;

  @ManyToOne(() => UwClaim, claim => claim.documents)
  @JoinColumn({ name: 'claim_id' })
  claim: UwClaim;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  file_hash: string;

  @Column({ type: 'longtext' })
  file_content: string; // Base64 encoded

  @Column({ type: 'varchar', length: 100, nullable: true })
  document_type: string;

  @Column({ type: 'longtext', nullable: true })
  extracted_text: string; // Texto extraído del PDF

  @OneToMany(() => UwEvaluation, evaluation => evaluation.document)
  evaluations: UwEvaluation[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}