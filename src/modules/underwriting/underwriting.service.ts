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
      // Extraer del context si está disponible
      let contextData: any = {};
      if (dto.context) {
        try {
          contextData = typeof dto.context === 'string' ? JSON.parse(dto.context) : dto.context;
        } catch (e) {
          this.logger.warn('Failed to parse context:', e);
        }
      }
      
      const variables = {
        'CMS insured': dto.insured_name || contextData.insured_name,
        'Insurance Company': dto.insurance_company || contextData.insurance_company,
        'insured_address': dto.insured_address || contextData.insured_address,
        'insured_street': dto.insured_street || contextData.insured_street,
        'insured_city': dto.insured_city || contextData.insured_city,
        'insured_zip': dto.insured_zip || contextData.insured_zip,
        // Nuevas variables para las preguntas de matching
        'date_of_loss': dto.date_of_loss || contextData.date_of_loss,
        'policy_number': dto.policy_number || contextData.policy_number,
        'claim_number': dto.claim_number || contextData.claim_number,
        'type_of_job': dto.type_of_job || contextData.type_of_job
      };

      // Procesar documentos enviados por n8n
      const documentsToProcess = [
        { name: 'LOP.pdf', content: dto.lop_pdf },
        { name: 'POLICY.pdf', content: dto.policy_pdf }
      ];
      
      for (const document of documentsToProcess) {
        if (!document.content) {
          this.logger.warn(`${document.name} not provided, skipping`);
          continue;
        }

        try {
          this.logger.log(`Processing document: ${document.name}`);
          
          const documentResults = await this.processDocumentWithContent(
            dto.record_id,
            document.name,
            document.content,
            variables
          );
          
          results[document.name] = documentResults;
          totalFields += documentResults.length;
          answeredFields += documentResults.filter(r => !r.error).length;
          
        } catch (error) {
          this.logger.error(`Error processing document ${document.name}:`, error);
          errors.push(`${document.name}: ${error.message}`);
          results[document.name] = [];
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
          total_documents: documentsToProcess.filter(d => d.content).length,
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

  private async processDocumentWithContent(
    recordId: string,
    documentName: string,
    pdfContent: string,
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

      // 2. Extraer texto del PDF
      const extractedText = await this.pdfParserService.extractTextFromBase64(pdfContent);
      this.logger.log(`Extracted ${extractedText.length} characters from ${documentName}`);

      // 4. Procesar prompts en paralelo con límite de concurrencia
      const concurrencyLimit = 3; // Máximo 3 requests simultáneos
      const processPromise = async (prompt: any) => {
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
          const aiResponse = await this.openAiService.evaluateWithValidation(
            extractedText,
            processedQuestion,
            prompt.expectedType as any
          );

          const processingTime = Date.now() - startTime;

          // Crear resultado
          const result = {
            pmc_field: prompt.pmcField,
            question: processedQuestion,
            answer: aiResponse.response,
            confidence: aiResponse.confidence,
            expected_type: prompt.expectedType,
            processing_time_ms: processingTime,
          };

          this.logger.log(`✅ ${prompt.pmcField}: ${aiResponse.response} (${aiResponse.confidence}% confidence)`);
          return result;

        } catch (error) {
          this.logger.error(`Error processing field ${prompt.pmcField}:`, error);
          return {
            pmc_field: prompt.pmcField,
            question: prompt.question,
            answer: null,
            confidence: 0,
            expected_type: prompt.expectedType,
            error: error.message,
          };
        }
      };

      // Procesar en batches con límite de concurrencia
      const promptResults = await this.processConcurrently(prompts, processPromise, concurrencyLimit);
      results.push(...promptResults);

      return results;

    } catch (error) {
      this.logger.error(`Error processing document ${documentName}:`, error);
      throw error;
    }
  }


  private async processDocument(
    claimReference: string,
    filename: string,
    fileContent: string,
    variables?: Record<string, string>
  ): Promise<PMCFieldResultDto[]> {
    const results: PMCFieldResultDto[] = [];

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
          pmc_field: prompt.pmcField || prompt.question,
          question,
          answer: evaluation.response,
          confidence: evaluation.final_confidence,
          expected_type: prompt.expectedType,
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
          pmc_field: prompt.pmcField || prompt.question,
          question: prompt.question,
          answer: null,
          confidence: 0,
          expected_type: prompt.expectedType,
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

  private async processConcurrently<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrencyLimit: number
  ): Promise<R[]> {
    const results: (R | null)[] = new Array(items.length).fill(null);
    const executing: Promise<void>[] = [];

    for (let i = 0; i < items.length; i++) {
      const index = i; // Capturar índice para mantener orden
      const item = items[index];
      
      const promise = processor(item).then(
        result => {
          results[index] = result; // Guardar en posición correcta
        },
        error => {
          this.logger.error(`Error processing item at index ${index}:`, error);
          results[index] = null; // Marcar error pero mantener posición
        }
      );

      executing.push(promise);

      if (executing.length >= concurrencyLimit) {
        await Promise.race(executing);
        // Limpiar promesas completadas
        for (let j = executing.length - 1; j >= 0; j--) {
          if (await Promise.race([executing[j], Promise.resolve('pending')]) !== 'pending') {
            executing.splice(j, 1);
          }
        }
      }
    }

    await Promise.all(executing);
    return results.filter(r => r !== null) as R[]; // Retornar solo resultados válidos
  }
}