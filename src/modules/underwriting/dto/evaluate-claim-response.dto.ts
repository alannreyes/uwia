export class EvaluationResultDto {
  prompt: string;
  expected_type: string;
  response: string;
  confidence: number;
  validation_response: string;
  validation_confidence: number;
  final_confidence: number;
}

export class DocumentResultDto {
  filename: string;
  document_type?: string;
  extraction_success: boolean;
  evaluations: EvaluationResultDto[];
  processing_time_ms: number;
}

export class EvaluateClaimResponseDto {
  success: boolean;
  claim_reference: string;
  claim_id: string;
  processing_time_ms: number;
  documents: DocumentResultDto[];
  error?: string;
  metadata?: any;
}