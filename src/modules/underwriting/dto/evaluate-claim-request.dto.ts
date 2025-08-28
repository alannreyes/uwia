import { IsString, IsOptional } from 'class-validator';

export class EvaluateClaimRequestDto {
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
  record_id?: string;

  @IsOptional()
  @IsString()
  carpeta_id?: string; // Google Drive folder ID

  // Archivos PDF en base64 (enviados por n8n)
  @IsOptional()
  @IsString()
  lop_pdf?: string; // LOP.pdf en base64

  @IsOptional()
  @IsString()
  policy_pdf?: string; // POLICY.pdf en base64

  // Campo genérico para archivo (para compatibilidad)
  @IsOptional()
  @IsString()
  file_data?: string; // Archivo genérico en base64

  // Context con toda la información del caso
  @IsOptional()
  context?: any; // Puede ser string JSON o objeto

  // Nuevos campos para matching
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

  @IsOptional()
  @IsString()
  cause_of_loss?: string;

  // Campo para identificar el documento en multipart
  @IsOptional()
  @IsString()
  document_name?: string;
}