export class EvaluationResultDto {
  question: string;
  response: string;
  confidence: number;
  error?: string;
}

export class DocumentResultDto {
  filename: string;
  evaluations: EvaluationResultDto[];
  error?: string;
}

export class EvaluateClaimResponseDto {
  claim_reference: string;
  status: 'success' | 'partial' | 'error';
  results: Record<string, EvaluationResultDto[]>; // Keyed by filename
  summary: {
    total_documents: number;
    processed_documents: number;
    total_questions: number;
    answered_questions: number;
  };
  errors?: string[];
  created_at: Date;
}