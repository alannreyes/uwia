import { IsString, IsOptional } from 'class-validator';

export class EvaluateClaimRequestDto {
  @IsString()
  insured_name: string;

  @IsString()
  insurance_company: string;

  @IsString()
  insured_address: string;

  @IsString()
  insured_street: string;

  @IsString()
  insured_city: string;

  @IsString()
  insured_zip: string;

  @IsString()
  record_id: string;

  @IsString()
  carpeta_id: string; // Google Drive folder ID

  // Archivos PDF en base64 (enviados por n8n)
  @IsOptional()
  @IsString()
  lop_pdf?: string; // LOP.pdf en base64

  @IsOptional()
  @IsString()
  policy_pdf?: string; // POLICY.pdf en base64
}