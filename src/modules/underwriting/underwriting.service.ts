import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentPrompt } from './entities/document-prompt.entity';
import { ClaimEvaluation } from './entities/claim-evaluation.entity';
import { EvaluateClaimRequestDto } from './dto/evaluate-claim-request.dto';
import { EvaluateClaimResponseDto, PMCFieldResultDto } from './dto/evaluate-claim-response.dto';
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
    const results: Record<string, any[]> = {};
    const errors: string[] = [];
    let totalFields = 0;
    let answeredFields = 0;

    try {
      this.logger.log(`Processing claim for record_id: ${dto.record_id}`);
      
      // Variables dinámicas para reemplazar en los prompts
      const variables = {
        'CMS insured': dto.insured_name,
        'Insurance Company': dto.insurance_company,
        'insured_address': dto.insured_address,
        'insured_street': dto.insured_street,
        'insured_city': dto.insured_city,
        'insured_zip': dto.insured_zip
      };

      // Procesar documentos específicos
      const documentsToProcess = ['LOP.pdf', 'POLICY.pdf'];
      
      for (const documentName of documentsToProcess) {
        try {
          this.logger.log(`Processing document: ${documentName}`);
          
          const documentResults = await this.processDocumentFromGoogleDrive(
            dto.record_id,
            documentName,
            dto.carpeta_id,
            variables
          );
          
          results[documentName] = documentResults;
          totalFields += documentResults.length;
          answeredFields += documentResults.filter(r => !r.error).length;
          
        } catch (error) {
          this.logger.error(`Error processing document ${documentName}:`, error);
          errors.push(`${documentName}: ${error.message}`);
          results[documentName] = [];
        }
      }

      // Determine overall status
      let status: 'success' | 'partial' | 'error';
      if (errors.length === 0) {
        status = 'success';
      } else if (answeredFields > 0) {
        status = 'partial';
      } else {
        status = 'error';
      }

      return {
        record_id: dto.record_id,
        status,
        results,
        summary: {
          total_documents: documentsToProcess.length,
          processed_documents: Object.keys(results).filter(k => results[k].length > 0).length,
          total_fields: totalFields,
          answered_fields: answeredFields,
        },
        errors: errors.length > 0 ? errors : undefined,
        processed_at: new Date(),
      };

    } catch (error) {
      this.logger.error('Error in evaluateClaim:', error);
      throw new HttpException(
        'Failed to process claim evaluation',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private async processDocumentFromGoogleDrive(
    recordId: string,
    documentName: string,
    carpetaId: string,
    variables: Record<string, string>
  ): Promise<any[]> {
    const results: any[] = [];

    try {
      // 1. Obtener prompts configurados para este documento
      const prompts = await this.documentPromptRepository.find({
        where: {
          documentName: documentName,
          active: true,
        },
        order: {
          promptOrder: 'ASC',
        },
      });

      if (prompts.length === 0) {
        this.logger.warn(`No prompts configured for document: ${documentName}`);
        return [];
      }

      this.logger.log(`Found ${prompts.length} prompts for ${documentName}`);

      // 2. Descargar PDF de Google Drive (por ahora simular)
      const pdfContent = await this.downloadPdfFromGoogleDrive(carpetaId, documentName);
      
      // 3. Extraer texto del PDF
      const extractedText = await this.pdfParserService.extractTextFromBase64(pdfContent);
      this.logger.log(`Extracted ${extractedText.length} characters from ${documentName}`);

      // 4. Procesar cada prompt
      for (const prompt of prompts) {
        const startTime = Date.now();
        
        try {
          // Reemplazar variables dinámicas en la pregunta
          let processedQuestion = prompt.question;
          Object.entries(variables).forEach(([key, value]) => {
            const placeholder = `%${key}%`;
            processedQuestion = processedQuestion.replace(new RegExp(placeholder, 'g'), value);
          });

          this.logger.log(`Processing field: ${prompt.pmcField}`);
          this.logger.log(`Question: ${processedQuestion}`);

          // Llamar a OpenAI
          const aiResponse = await this.openAiService.processDocumentQuestion(
            extractedText,
            processedQuestion,
            prompt.expectedType
          );

          const processingTime = Date.now() - startTime;

          // Guardar resultado
          const result = {
            pmc_field: prompt.pmcField,
            question: processedQuestion,
            answer: aiResponse.response,
            confidence: aiResponse.confidence,
            expected_type: prompt.expectedType,
            processing_time_ms: processingTime,
          };

          results.push(result);
          this.logger.log(`✅ ${prompt.pmcField}: ${aiResponse.response} (${aiResponse.confidence}% confidence)`);

        } catch (error) {
          this.logger.error(`Error processing field ${prompt.pmcField}:`, error);
          results.push({
            pmc_field: prompt.pmcField,
            question: prompt.question,
            answer: null,
            confidence: 0,
            expected_type: prompt.expectedType,
            error: error.message,
          });
        }
      }

      return results;

    } catch (error) {
      this.logger.error(`Error processing document ${documentName}:`, error);
      throw error;
    }
  }

  private async downloadPdfFromGoogleDrive(carpetaId: string, filename: string): Promise<string> {
    // TODO: Implementar descarga real de Google Drive
    // Por ahora devolver un PDF de ejemplo en base64
    this.logger.warn(`Simulating download of ${filename} from Google Drive folder ${carpetaId}`);
    
    // Esto es temporal - necesitas implementar la integración real con Google Drive
    throw new Error(`Google Drive integration not implemented yet. Cannot download ${filename} from folder ${carpetaId}`);
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

    // Extract text from PDF (fileContent is base64 string)
    const extractedText = await this.pdfParserService.extractTextFromBase64(fileContent);
    
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