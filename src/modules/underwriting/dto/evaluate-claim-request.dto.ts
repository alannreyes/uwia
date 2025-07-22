import { IsString, IsArray, ValidateNested, IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export enum PromptResponseType {
  BOOLEAN = 'boolean',
  DATE = 'date',
  TEXT = 'text',
  NUMBER = 'number',
  JSON = 'json'
}

export class PromptDto {
  @IsString()
  question: string;

  @IsEnum(PromptResponseType)
  expected_type: PromptResponseType;

  @IsOptional()
  @IsString()
  additional_context?: string;
}

export class DocumentDto {
  @IsString()
  filename: string;

  @IsString()
  file_content: string; // Base64 encoded

  @IsOptional()
  @IsString()
  document_type?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromptDto)
  prompts: PromptDto[];
}

export class EvaluateClaimRequestDto {
  @IsString()
  claim_reference: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentDto)
  documents: DocumentDto[];

  @IsOptional()
  metadata?: any;
}