export class PMCFieldResultDto {
  pmc_field: string;
  question: string;
  answer: string;
  confidence: number;
  expected_type: string;
  error?: string;
  processing_time?: number;
}

export class DocumentResultDto {
  document_name: string;
  fields: PMCFieldResultDto[];
  error?: string;
}

export class EvaluateClaimResponseDto {
  record_id: string;
  status: 'success' | 'partial' | 'error';
  results: Record<string, PMCFieldResultDto[]>; // Keyed by document name (LOP.pdf, POLICY.pdf)
  summary: {
    total_documents: number;
    processed_documents: number;
    total_fields: number;
    answered_fields: number;
  };
  errors?: string[];
  processed_at: Date;
}