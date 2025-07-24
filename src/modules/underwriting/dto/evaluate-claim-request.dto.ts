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
}