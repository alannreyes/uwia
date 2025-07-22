import { IsString, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class DocumentDto {
  @IsString()
  filename: string;

  @IsString()
  file_content: string; // Base64 encoded
}

export class EvaluateClaimRequestDto {
  @IsString()
  claim_reference: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentDto)
  documents: DocumentDto[];

  @IsOptional()
  variables?: Record<string, string>; // Para reemplazar placeholders como %CMS insured%
}