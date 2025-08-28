import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DocumentDto {
  @IsString()
  document_name: string; // COC, ESTIMATE, LOP, POLICY, etc.

  @IsString()
  file_data: string; // Base64 encoded PDF
}

export class EvaluateClaimBatchRequestDto {
  @IsString()
  record_id: string;

  @IsString()
  carpeta_id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentDto)
  documents: DocumentDto[];

  @IsOptional()
  context?: any; // Context con toda la información del caso

  // Campos opcionales del contexto
  @IsOptional()
  @IsString()
  insured_name?: string;

  @IsOptional()
  @IsString()
  insurance_company?: string;

  @IsOptional()
  @IsString()
  insured_address?: string;

  @IsOptional()
  @IsString()
  insured_street?: string;

  @IsOptional()
  @IsString()
  insured_city?: string;

  @IsOptional()
  @IsString()
  insured_zip?: string;

  @IsOptional()
  @IsString()
  date_of_loss?: string;

  @IsOptional()
  @IsString()
  policy_number?: string;

  @IsOptional()
  @IsString()
  claim_number?: string;

  @IsOptional()
  @IsString()
  type_of_job?: string;
}