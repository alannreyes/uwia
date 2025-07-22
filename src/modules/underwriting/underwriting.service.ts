import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentPrompt } from './entities/document-prompt.entity';
import { ClaimEvaluation } from './entities/claim-evaluation.entity';
import { EvaluateClaimRequestDto } from './dto/evaluate-claim-request.dto';
import { EvaluateClaimResponseDto, EvaluationResultDto } from './dto/evaluate-claim-response.dto';
import { OpenAiService } from './services/openai.service';
import { PdfParserService } from './services/pdf-parser.service';
import { ResponseType } from './entities/uw-evaluation.entity';

@Injectable()
export class UnderwritingService {
  private readonly logger = new Logger(UnderwritingService.name);

  constructor(
    @InjectRepository(DocumentPrompt)
    private documentPromptRepository: Repository<DocumentPrompt>,
    @InjectRepository(ClaimEvaluation)
    private claimEvaluationRepository: Repository<ClaimEvaluation>,
    private openAiService: OpenAiService,
    private pdfParserService: PdfParserService,
  ) {}

  async evaluateClaim(dto: EvaluateClaimRequestDto): Promise<EvaluateClaimResponseDto> {
    const startTime = Date.now();
    const results: Record<string, EvaluationResultDto[]> = {};
    const errors: string[] = [];
    let totalQuestions = 0;
    let answeredQuestions = 0;

    try {
      // Process each document
      for (const document of dto.documents) {
        try {
          const documentResults = await this.processDocument(
            dto.claim_reference,
            document.filename,
            document.file_content,
            dto.variables
          );
          
          results[document.filename] = documentResults;
          totalQuestions += documentResults.length;
          answeredQuestions += documentResults.filter(r => !r.error).length;
          
        } catch (error) {
          this.logger.error(`Error processing document ${document.filename}:`, error);
          errors.push(`${document.filename}: ${error.message}`);
          results[document.filename] = [];
        }
      }

      // Determine overall status
      let status: 'success' | 'partial' | 'error';
      if (errors.length === 0) {
        status = 'success';
      } else if (answeredQuestions > 0) {
        status = 'partial';
      } else {
        status = 'error';
      }

      return {
        claim_reference: dto.claim_reference,
        status,
        results,
        summary: {
          total_documents: dto.documents.length,
          processed_documents: Object.keys(results).filter(k => results[k].length > 0).length,
          total_questions: totalQuestions,
          answered_questions: answeredQuestions,
        },
        errors: errors.length > 0 ? errors : undefined,
        created_at: new Date(),
      };

    } catch (error) {
      this.logger.error('Error in evaluateClaim:', error);
      throw new HttpException(
        'Failed to process claim evaluation',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private async processDocument(
    claimReference: string,
    filename: string,
    fileContent: string,
    variables?: Record<string, string>
  ): Promise<EvaluationResultDto[]> {
    const results: EvaluationResultDto[] = [];

    // Get prompts for this document type
    const prompts = await this.documentPromptRepository.find({
      where: {
        documentName: filename,
        active: true,
      },
      order: {
        promptOrder: 'ASC',
      },
    });

    if (prompts.length === 0) {
      this.logger.warn(`No prompts configured for document: ${filename}`);
      return []; // Return empty array silently
    }

    // Extract text from PDF
    const extractedText = await this.pdfParserService.extractText(fileContent);
    
    // Process each prompt
    for (const prompt of prompts) {
      const startTime = Date.now();
      
      try {
        // Replace variables in question if any
        let question = prompt.question;
        if (variables) {
          Object.entries(variables).forEach(([key, value]) => {
            question = question.replace(new RegExp(`%${key}%`, 'g'), value);
          });
        }

        // Get response from OpenAI
        const evaluation = await this.openAiService.evaluateWithValidation(
          extractedText,
          question,
          this.mapExpectedType(prompt.expectedType),
          undefined
        );

        // Save to database
        const savedEvaluation = await this.claimEvaluationRepository.save({
          claimReference,
          documentName: filename,
          promptId: prompt.id,
          question,
          response: evaluation.response,
          confidence: evaluation.confidence,
          validationResponse: evaluation.validation_response,
          validationConfidence: evaluation.validation_confidence,
          finalConfidence: evaluation.final_confidence,
          processingTimeMs: Date.now() - startTime,
        });

        results.push({
          question,
          response: evaluation.response,
          confidence: evaluation.final_confidence,
        });

      } catch (error) {
        this.logger.error(`Error processing prompt ${prompt.id}:`, error);
        
        // Save error to database
        await this.claimEvaluationRepository.save({
          claimReference,
          documentName: filename,
          promptId: prompt.id,
          question: prompt.question,
          errorMessage: error.message,
          processingTimeMs: Date.now() - startTime,
        });

        results.push({
          question: prompt.question,
          response: null,
          confidence: 0,
          error: error.message,
        });
      }
    }

    return results;
  }

  private mapExpectedType(type: string): ResponseType {
    const mapping: Record<string, ResponseType> = {
      'boolean': ResponseType.BOOLEAN,
      'date': ResponseType.DATE,
      'text': ResponseType.TEXT,
      'number': ResponseType.NUMBER,
      'json': ResponseType.JSON,
    };
    return mapping[type.toLowerCase()] || ResponseType.TEXT;
  }

  async getDocumentPrompts(documentName?: string) {
    const where: any = { active: true };
    if (documentName) {
      where.documentName = documentName;
    }

    return this.documentPromptRepository.find({
      where,
      order: {
        documentName: 'ASC',
        promptOrder: 'ASC',
      },
    });
  }

  async getClaimHistory(claimReference: string) {
    return this.claimEvaluationRepository.find({
      where: { claimReference },
      relations: ['prompt'],
      order: {
        createdAt: 'DESC',
      },
    });
  }
}