import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentPrompt } from './entities/document-prompt.entity';
import { ClaimEvaluation } from './entities/claim-evaluation.entity';
import { EvaluateClaimRequestDto } from './dto/evaluate-claim-request.dto';
import { EvaluateClaimResponseDto, PMCFieldResultDto } from './dto/evaluate-claim-response.dto';
import { DocumentDto } from './dto/evaluate-claim-batch-request.dto';
import { OpenAiService } from './services/openai.service';
import { PdfParserService } from './services/pdf-parser.service';
import { PdfFormExtractorService } from './services/pdf-form-extractor.service';
import { PdfHybridAnalyzerService } from './services/pdf-hybrid-analyzer.service';
import { PdfStreamProcessorService } from './services/pdf-stream-processor.service';
import { PdfImageService } from './services/pdf-image.service';
import { AdaptiveProcessingStrategyService } from './services/adaptive-processing-strategy.service';
import { ResponseType } from './entities/uw-evaluation.entity';
import { openaiConfig } from '../../config/openai.config';

@Injectable()
export class UnderwritingService {
  private readonly logger = new Logger(UnderwritingService.name);
  private visualAnalysisCache = new Map<string, boolean>();

  constructor(
    @InjectRepository(DocumentPrompt)
    private documentPromptRepository: Repository<DocumentPrompt>,
    @InjectRepository(ClaimEvaluation)
    private claimEvaluationRepository: Repository<ClaimEvaluation>,
    private openAiService: OpenAiService,
    private pdfParserService: PdfParserService,
    private pdfFormExtractor: PdfFormExtractorService,
    private pdfHybridAnalyzer: PdfHybridAnalyzerService,
    private pdfStreamProcessor: PdfStreamProcessorService,
    private pdfImageService: PdfImageService,
    private adaptiveStrategy: AdaptiveProcessingStrategyService,
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
      
      // Usar función centralizada para mapeo consistente de variables
      const variables = this.getVariableMapping(dto, contextData);

      // MODIFICACIÓN: Procesar SOLO el documento específico enviado
      let documentToProcess: string;
      let pdfContent: string | null = null;
      
      // Determinar qué documento se está enviando
      if (dto.document_name) {
        // Si viene con document_name explícito (multipart)
        documentToProcess = dto.document_name.endsWith('.pdf') 
          ? dto.document_name 
          : `${dto.document_name}.pdf`;
        pdfContent = dto.file_data || null;
      } else {
        // Buscar por campos específicos (lop_pdf, policy_pdf, etc.)
        if (dto.lop_pdf) {
          documentToProcess = 'LOP.pdf';
          pdfContent = dto.lop_pdf;
        } else if (dto.policy_pdf) {
          documentToProcess = 'POLICY.pdf';
          pdfContent = dto.policy_pdf;
        } else if (dto.file_data) {
          // Si solo hay file_data sin document_name, no podemos determinar el documento
          throw new Error('document_name is required when sending file_data');
        } else {
          throw new Error('No document provided in request');
        }
      }

      this.logger.log(`Processing ONLY document: ${documentToProcess}`);
      
      // Verificar si el documento tiene preguntas en la BD
      const documentPrompts = await this.documentPromptRepository.find({
        where: { documentName: documentToProcess, active: true },
        order: { promptOrder: 'ASC' }
      });
      
      if (documentPrompts.length === 0) {
        this.logger.warn(`⚠️ No configuration found for document: ${documentToProcess} - SKIPPING`);
        // Continúa con el procesamiento de otros documentos
        results[documentToProcess] = [{
          pmc_field: 'document_not_configured',
          question: `Document ${documentToProcess} not configured in system`,
          answer: 'SKIPPED',
          confidence: 0,
          processing_time: 0,
          error: `No questions configured for document: ${documentToProcess}`
        }];
        return {
          record_id: dto.record_id,
          status: 'success' as const,
          results,
          summary: {
            total_documents: 1,
            processed_documents: 0,
            total_fields: totalFields,
            answered_fields: answeredFields,
          },
          processed_at: new Date(),
        };
      }
      
      this.logger.log(`Found ${documentPrompts.length} questions for ${documentToProcess}`);
      
      // Procesar SOLO este documento
      try {
        const documentResults = await this.processDocumentWithContent(
          dto.record_id,
          documentToProcess,
          pdfContent,
          variables
        );
        
        results[documentToProcess] = documentResults;
        totalFields += documentResults.length;
        answeredFields += documentResults.filter(r => !r.error).length;
        
      } catch (error) {
        this.logger.error(`Error processing document ${documentToProcess}:`, error);
        errors.push(`${documentToProcess}: ${error.message}`);
        results[documentToProcess] = [];
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
          total_documents: 1, // Solo procesamos el documento enviado
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
    pdfContent: string | null,
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
        this.logger.warn(`⚠️ No prompts configured for document: ${documentName} - returning SKIPPED result`);
        return [{
          pmc_field: 'document_not_configured',
          question: `Document ${documentName} not configured in system`,
          answer: 'SKIPPED',
          confidence: 0,
          processing_time: 0,
          error: `No questions configured for document: ${documentName}`
        }];
      }

      this.logger.log(`Found ${prompts.length} prompts for ${documentName}`);

      // 2. NUEVO: Analizar qué tipo de procesamiento necesita el documento
      const documentNeeds = this.analyzeDocumentRequirements(prompts);
      this.logger.log(`Document analysis: needsText=${documentNeeds.needsText}, needsVisual=${documentNeeds.needsVisual}`);

      // 3. Preparar el documento según las necesidades detectadas
      const preparedDocument = await this.prepareDocument(pdfContent, documentNeeds);

      // Mantener compatibilidad con código existente
      let extractedText = preparedDocument.text || '';
      if (extractedText) {
        this.logger.log(`Extracted ${extractedText.length} characters from ${documentName}`);
      } else if (documentNeeds.needsVisual) {
        this.logger.warn(`No text extracted from ${documentName}, will rely on visual analysis`);
      }

      // 4. MEJORADO: Procesamiento inteligente con control de concurrencia
      // Identificar campos críticos que necesitan procesamiento secuencial
      const criticalFields = ['lop_signed_by_ho1', 'lop_signed_by_client1', 'signed_insured_next_amount'];
      const isCriticalDocument = documentName.toLowerCase().includes('lop') || 
                                 documentName.toLowerCase().includes('estimate');
      
      // Configurar concurrencia basada en tipo de documento y campo - OPTIMIZADO
      const concurrencyLimit = isCriticalDocument ? 2 : 3; // Moderada concurrencia para documentos críticos
      const delayBetweenRequests = isCriticalDocument ? 2000 : 1000; // 2s para críticos, 1s para otros
      
      this.logger.log(`📋 Processing strategy for ${documentName}:`);
      this.logger.log(`   - Concurrency: ${concurrencyLimit}`);
      this.logger.log(`   - Delay between: ${delayBetweenRequests}ms`);
      this.logger.log(`   - Total prompts: ${prompts.length}`);
      
      const processPromise = async (prompt: any, index: number) => {
        // Agregar delay moderado solo entre batches para evitar rate limiting
        if (index > 0 && index % concurrencyLimit === 0) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
          this.logger.log(`⏳ Delay ${delayBetweenRequests}ms before processing ${prompt.pmcField}`);
        }
        const startTime = Date.now();
        
        try {
          // Reemplazar variables dinámicas en la pregunta
          let processedQuestion = prompt.question;
          Object.entries(variables).forEach(([key, value]) => {
            const placeholder = `%${key}%`;
            // Escapar caracteres especiales de regex para evitar errores
            const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            processedQuestion = processedQuestion.replace(new RegExp(escapedPlaceholder, 'g'), value);
          });

          this.logger.log(`Processing field: ${prompt.pmcField}`);
          this.logger.log(`Question: ${processedQuestion}`);

          // Para preguntas que no requieren documento (matching, etc)
          if (!extractedText && (prompt.pmcField.includes('_match') || prompt.pmcField.includes('matching_'))) {
            // Estas preguntas ya tienen las variables reemplazadas, no necesitan PDF
            this.logger.log(`Processing matching question without PDF: ${prompt.pmcField}`);
            // Dar una respuesta por defecto ya que no podemos comparar sin el documento
            return {
              pmc_field: prompt.pmcField,
              question: processedQuestion,
              answer: 'NO',
              confidence: 0.0,
              expected_type: prompt.expectedType,
              processing_time_ms: 1,
              error: 'No document provided for comparison'
            };
          }

          // NUEVO: Determinar estrategia adaptativa para máxima precisión
          this.logger.log(`🔄 Determining strategy for: ${prompt.pmcField}`);
          
          let strategy;
          try {
            strategy = await this.adaptiveStrategy.determineStrategy(
              prompt.pmcField,
              processedQuestion,
              prompt.expectedType,
              preparedDocument.images && preparedDocument.images.size > 0
            );
          } catch (strategyError) {
            this.logger.error(`❌ Strategy determination failed for ${prompt.pmcField}: ${strategyError.message}`);
            this.logger.error(`Stack trace: ${strategyError.stack}`);
            
            // Fallback inteligente mejorado basado en patrones del campo
            strategy = this.getIntelligentFallbackStrategy(prompt.pmcField, processedQuestion, prompt.expectedType);
            this.logger.warn(`⚠️ Using intelligent fallback strategy for ${prompt.pmcField}: Visual=${strategy.useVisualAnalysis}, Model=${strategy.primaryModel}`);
          }

          let needsVisual = strategy.useVisualAnalysis;
          let useDualValidation = strategy.useDualValidation;
          
          // Si no hay texto y la pregunta lo requiere, forzar análisis visual
          if (!extractedText) {
            this.logger.warn(`No text extracted for ${prompt.pmcField}, forcing visual analysis`);
            needsVisual = true;
          }
          
          let aiResponse;
          
          if (needsVisual && preparedDocument.images && preparedDocument.images.size > 0) {
            // Usar Vision API para preguntas visuales analizando TODAS las páginas
            this.logger.log(`📸 Using Vision API for: ${prompt.pmcField} - Analyzing ${preparedDocument.images.size} page(s)`);
            
            // Analizar TODAS las páginas disponibles
            const pageNumbers = Array.from(preparedDocument.images.keys()).sort((a, b) => a - b);
            this.logger.log(`🔍 Pages to analyze: ${pageNumbers.join(', ')}`);
            
            let bestResponse: any = null;
            let bestConfidence = 0;
            let foundPositiveAnswer = false;
            
            // Iterar através de todas las páginas (priorizar primeras páginas para campos comunes)
            const prioritizedPages = this.prioritizePages(pageNumbers, prompt.pmcField);
            for (const pageNumber of prioritizedPages) {
              const pageImage = preparedDocument.images.get(pageNumber);
              
              if (pageImage) {
                this.logger.log(`🎯 Analyzing page ${pageNumber} for: ${prompt.pmcField}`);
                
                try {
                  const pageResponse = await this.openAiService.evaluateWithVision(
                    pageImage,
                    processedQuestion,
                    prompt.expectedType as any,
                    prompt.pmcField,
                    pageNumber
                  );
                  
                  this.logger.log(`📊 Page ${pageNumber} result: ${pageResponse.response} (confidence: ${pageResponse.confidence})`);
                  
                  // EARLY EXIT: Para campos de firma/booleanos, si encontramos un "YES" con buena confianza
                  if (prompt.expectedType === 'boolean' && 
                      pageResponse.response === 'YES' && 
                      pageResponse.confidence >= 0.7) {
                    this.logger.log(`✅ EARLY EXIT: Found positive answer on page ${pageNumber} (confidence: ${pageResponse.confidence})`);
                    aiResponse = pageResponse;
                    foundPositiveAnswer = true;
                    break;
                  }
                  
                  // EARLY EXIT: Para campos de texto/fecha/número con alta confianza
                  if ((prompt.expectedType === 'text' || prompt.expectedType === 'date' || prompt.expectedType === 'number') &&
                      pageResponse.response !== 'not found' && 
                      pageResponse.response !== '' &&
                      pageResponse.confidence >= 0.85) {
                    this.logger.log(`✅ EARLY EXIT: Found confident answer on page ${pageNumber}: ${pageResponse.response} (${pageResponse.confidence})`);
                    aiResponse = pageResponse;
                    foundPositiveAnswer = true;
                    break;
                  }
                  
                  // Mantener la mejor respuesta basada en lógica inteligente
                  if (!bestResponse || this.isBetterResponse(pageResponse, bestResponse, prompt.expectedType)) {
                    bestResponse = pageResponse;
                    bestConfidence = pageResponse.confidence;
                  }
                  
                } catch (pageError) {
                  this.logger.warn(`⚠️ Error analyzing page ${pageNumber}: ${pageError.message}`);
                  continue;
                }
              }
            }
            
            // Si no encontramos una respuesta positiva, usar la de mayor confianza
            if (!foundPositiveAnswer && bestResponse) {
              this.logger.log(`📊 No positive answers found. Using best confidence result: ${bestResponse.response} (${bestResponse.confidence})`);
              aiResponse = bestResponse;
            }
            
            if (!aiResponse) {
              throw new Error('No pages could be analyzed successfully');
            }
          } else {
            // Usar análisis de texto con estrategia adaptativa
            if (useDualValidation && openaiConfig.dualValidation) {
              this.logger.log(`🔄 Using dual validation for ${prompt.pmcField} (strategy determined)`);
              aiResponse = await this.openAiService.evaluateWithDualValidation(
                extractedText,
                processedQuestion,
                prompt.expectedType as any,
                undefined,
                prompt.pmcField
              );
            } else {
              // Evaluación simple optimizada
              aiResponse = await this.openAiService.evaluateWithValidation(
                extractedText,
                processedQuestion,
                prompt.expectedType as any,
                undefined,
                prompt.pmcField
              );
            }
          }

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
          const processingTime = Date.now() - startTime;
          this.logger.error(`❌ Error processing field ${prompt.pmcField}:`, error.message);
          
          // Determinar tipo de error para mejor logging
          let errorType = 'Processing error';
          if (error.message.includes('timeout')) {
            errorType = 'Timeout error';
          } else if (error.message.includes('rate limit')) {
            errorType = 'Rate limit error';
          } else if (error.message.includes('too large')) {
            errorType = 'File size error';
          }
          
          this.logger.warn(`⚠️ ${errorType} for ${prompt.pmcField}, continuing with other fields`);
          
          return {
            pmc_field: prompt.pmcField,
            question: prompt.question,
            answer: null,
            confidence: 0,
            expected_type: prompt.expectedType,
            processing_time_ms: processingTime,
            error: `${errorType}: ${error.message}`,
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

    // NUEVO: Extract text using enhanced method with intelligent fallback
    const extractedText = await this.extractTextEnhanced(fileContent, filename);
    
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
    processor: (item: T, index: number) => Promise<R>,
    concurrencyLimit: number
  ): Promise<R[]> {
    const results: R[] = [];
    
    // Procesar items en chunks del tamaño de concurrencyLimit
    for (let i = 0; i < items.length; i += concurrencyLimit) {
      const chunk = items.slice(i, i + concurrencyLimit);
      
      // Procesar chunk en paralelo
      const chunkPromises = chunk.map((item, chunkIndex) => {
        const globalIndex = i + chunkIndex;
        return processor(item, globalIndex).catch(error => {
          this.logger.error(`Error processing item at index ${globalIndex}:`, error);
          return null;
        });
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      
      // Agregar resultados válidos
      chunkResults.forEach(result => {
        if (result !== null) {
          results.push(result);
        }
      });
    }

    return results;
  }

  async evaluateClaimBatch(
    dto: EvaluateClaimRequestDto, 
    documents: DocumentDto[]
  ): Promise<EvaluateClaimResponseDto> {
    const startTime = Date.now();
    const results: Record<string, any[]> = {};
    const errors: string[] = [];
    let totalFields = 0;
    let answeredFields = 0;

    try {
      this.logger.log(`🚀 Processing batch claim for record_id: ${dto.record_id}`);
      this.logger.log(`📋 DEBUG - Record ID details: [${dto.record_id}] - Length: ${dto.record_id?.length} - Type: ${typeof dto.record_id}`);
      this.logger.log(`📄 Documents to process: ${documents.length}`);
      
      // Variables dinámicas para reemplazar en los prompts
      let contextData: any = {};
      if (dto.context) {
        try {
          contextData = typeof dto.context === 'string' ? JSON.parse(dto.context) : dto.context;
        } catch (e) {
          this.logger.warn('Failed to parse context:', e);
        }
      }
      
      // Usar función centralizada para mapeo consistente de variables
      const variables = this.getVariableMapping(dto, contextData);

      // Crear un mapa de documentos para acceso rápido
      const documentMap = new Map<string, string>();
      documents.forEach(doc => {
        const docName = doc.document_name.endsWith('.pdf') 
          ? doc.document_name 
          : `${doc.document_name}.pdf`;
        documentMap.set(docName, doc.file_data);
      });

      // Obtener todas las preguntas únicas de la BD para los documentos proporcionados
      const documentNames = Array.from(documentMap.keys());
      const prompts = await this.documentPromptRepository
        .createQueryBuilder('dp')
        .where('dp.active = :active', { active: true })
        .andWhere('dp.document_name IN (:...documentNames)', { documentNames })
        .orderBy('dp.document_name', 'ASC')
        .addOrderBy('dp.prompt_order', 'ASC')
        .getMany();

      // Agrupar prompts por documento
      const promptsByDocument = new Map<string, any[]>();
      prompts.forEach(prompt => {
        if (!promptsByDocument.has(prompt.documentName)) {
          promptsByDocument.set(prompt.documentName, []);
        }
        promptsByDocument.get(prompt.documentName).push(prompt);
      });

      this.logger.log(`📋 Found ${prompts.length} total prompts across ${promptsByDocument.size} documents`);

      // Procesar cada documento con sus preguntas
      const documentPromises = Array.from(promptsByDocument.entries()).map(
        async ([documentName, documentPrompts]) => {
          const pdfContent = documentMap.get(documentName);
          
          if (!pdfContent) {
            this.logger.warn(`No PDF content provided for ${documentName}`);
            return {
              documentName,
              results: documentPrompts.map(prompt => ({
                pmc_field: prompt.pmcField,
                question: prompt.question,
                answer: null,
                confidence: 0,
                expected_type: prompt.expectedType,
                error: 'Document not provided in batch'
              }))
            };
          }

          try {
            this.logger.log(`Processing document: ${documentName} with ${documentPrompts.length} prompts`);
            
            const documentResults = await this.processDocumentWithContent(
              dto.record_id,
              documentName,
              pdfContent,
              variables
            );
            
            return {
              documentName,
              results: documentResults
            };
          } catch (error) {
            this.logger.error(`❌ Error processing document ${documentName}:`, error);
            return {
              documentName,
              results: [{
                pmc_field: 'document_processing_error',
                question: `Failed to process ${documentName}`,
                answer: 'ERROR',
                confidence: 0,
                processing_time: 0,
                error: error.message
              }],
              error: error.message
            };
          }
        }
      );

      // Procesar todos los documentos en paralelo
      const processedDocuments = await Promise.all(documentPromises);

      // Consolidar resultados
      processedDocuments.forEach(({ documentName, results: docResults, error }) => {
        if (error) {
          errors.push(`${documentName}: ${error}`);
          results[documentName] = [];
        } else {
          results[documentName] = docResults;
          totalFields += docResults.length;
          answeredFields += docResults.filter(r => !r.error).length;
        }
      });

      // Determine overall status
      let status: 'success' | 'partial' | 'error';
      if (errors.length === 0) {
        status = 'success';
      } else if (answeredFields > 0) {
        status = 'partial';
      } else {
        status = 'error';
      }

      const processingTime = Date.now() - startTime;
      this.logger.log(`✅ Batch processing completed in ${processingTime}ms`);
      this.logger.log(`📊 Processed ${Object.keys(results).length} documents, ${answeredFields}/${totalFields} fields answered`);

      return {
        record_id: dto.record_id,
        status,
        results,
        summary: {
          total_documents: documents.length,
          processed_documents: Object.keys(results).filter(k => results[k].length > 0).length,
          total_fields: totalFields,
          answered_fields: answeredFields,
        },
        errors: errors.length > 0 ? errors : undefined,
        processed_at: new Date(),
      };

    } catch (error) {
      this.logger.error('Error in evaluateClaimBatch:', error);
      throw new HttpException(
        'Failed to process batch claim evaluation',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // NUEVOS MÉTODOS PARA ANÁLISIS DINÁMICO

  /**
   * Analiza las preguntas de un documento para determinar qué tipo de procesamiento necesita
   */
  private analyzeDocumentRequirements(prompts: DocumentPrompt[]): {
    needsText: boolean;
    needsVisual: boolean;
    visualPages: number[];
    visualKeywords: string[];
  } {
    const VISUAL_INDICATORS = {
      signatures: ['signed', 'signature', 'firma', 'autograph', 'endorsement', 'signed by'],
      stamps: ['stamp', 'seal', 'sello', 'timbre', 'stamped'],
      checkboxes: ['marked', 'checked', 'selected', 'ticked', 'checkbox', 'check box'],
      handwriting: ['handwritten', 'filled by hand', 'manuscrito', 'written'],
      visual_elements: ['logo', 'image', 'photo', 'diagram', 'chart', 'visual']
    };

    const requirements = {
      needsText: false,
      needsVisual: false,
      visualPages: [] as number[],
      visualKeywords: [] as string[]
    };

    for (const prompt of prompts) {
      const questionLower = prompt.question.toLowerCase();
      const fieldLower = (prompt.pmcField || '').toLowerCase();
      
      // Verificar si necesita análisis visual
      let foundVisual = false;
      for (const [category, keywords] of Object.entries(VISUAL_INDICATORS)) {
        if (keywords.some(keyword => 
          questionLower.includes(keyword) || fieldLower.includes(keyword)
        )) {
          requirements.needsVisual = true;
          requirements.visualKeywords.push(category);
          foundVisual = true;
          
          // Inferir páginas según el tipo
          if (category === 'signatures') {
            // Las firmas suelen estar en primera y última página
            requirements.visualPages.push(1, -1);
          } else if (category === 'stamps') {
            // Los sellos suelen estar en primera página
            requirements.visualPages.push(1);
          }
        }
      }
      
      // La mayoría de preguntas también necesitan texto
      if (!foundVisual || questionLower.includes('date') || questionLower.includes('text') || 
          questionLower.includes('content') || questionLower.includes('amount')) {
        requirements.needsText = true;
      }
    }

    // Eliminar duplicados en páginas
    requirements.visualPages = [...new Set(requirements.visualPages)];
    
    return requirements;
  }

  /**
   * Prepara el documento según las necesidades detectadas
   */
  private async prepareDocument(
    pdfContent: string | null,
    requirements: { needsText: boolean; needsVisual: boolean; visualPages: number[] }
  ): Promise<{ text?: string; images?: Map<number, string> }> {
    const prepared: { text?: string; images?: Map<number, string> } = {};
    
    if (!pdfContent) {
      return prepared;
    }

    // Extraer texto si es necesario
    if (requirements.needsText) {
      try {
        prepared.text = await this.extractTextEnhanced(pdfContent, 'document');
      } catch (error) {
        this.logger.error('❌ Error extracting text:', error);
        this.logger.warn(`⚠️ Text extraction failed, continuing with visual analysis if needed`);
        prepared.text = ''; // Continuar sin texto
      }
    }

    // Convertir a imágenes si es necesario
    if (requirements.needsVisual) {
      try {
        // Si no se especificaron páginas, usar primera y última
        let pagesToConvert = requirements.visualPages;
        if (pagesToConvert.length === 0) {
          pagesToConvert = [1];
        }

        // Convertir páginas especiales (-1 = última página)
        if (pagesToConvert.includes(-1)) {
          // Para obtener la última página, primero necesitamos el conteo
          prepared.images = await this.pdfImageService.convertSignaturePages(pdfContent);
        } else {
          // Convertir páginas específicas
          prepared.images = await this.pdfImageService.convertPages(pdfContent, pagesToConvert);
        }
        
        this.logger.log(`📸 Converted ${prepared.images?.size || 0} pages to images`);
      } catch (error) {
        this.logger.error('❌ Error converting to images:', error);
        this.logger.warn(`⚠️ Visual analysis will be skipped, continuing with text-based questions`);
        // Si falla la conversión, intentar continuar con texto si está disponible
        prepared.images = new Map(); // Mapa vacío para evitar errores
      }
    }

    return prepared;
  }

  /**
   * Determina si una pregunta específica requiere análisis visual
   */
  private async requiresVisualAnalysis(pmcField: string, question: string): Promise<boolean> {
    // Cache key para evitar llamadas repetidas
    const cacheKey = `${pmcField}__${question.substring(0, 100)}`;
    
    if (this.visualAnalysisCache.has(cacheKey)) {
      const cached = this.visualAnalysisCache.get(cacheKey);
      this.logger.log(`📦 Using cached visual classification for ${pmcField}: ${cached}`);
      return cached;
    }

    try {
      // Usar IA para clasificación inteligente
      const classification = await this.openAiService.classifyVisualRequirement(pmcField, question);
      
      // Guardar en cache
      this.visualAnalysisCache.set(cacheKey, classification.requiresVisual);
      
      // Limpiar cache si crece demasiado (mantener últimas 100 entradas)
      if (this.visualAnalysisCache.size > 100) {
        const firstKey = this.visualAnalysisCache.keys().next().value;
        this.visualAnalysisCache.delete(firstKey);
      }
      
      this.logger.log(`🤖 AI classification for ${pmcField}: ${classification.requiresVisual} - ${classification.reason}`);
      return classification.requiresVisual;
      
    } catch (error) {
      this.logger.error(`Error in AI visual classification for ${pmcField}: ${error.message}`);
      
      // Fallback a detección básica mejorada en caso de error
      const fieldLower = pmcField.toLowerCase();
      const questionLower = question.toLowerCase();
      
      // Patrones mejorados para detección de firmas
      const signaturePatterns = [
        /sign/i,           // Cualquier variación de sign/signature
        /initial/i,        // Iniciales
        /autograph/i,      // Autógrafo
        /lop_.*_ho\d*/i,  // LOP homeowner con números
        /lop_.*_client\d*/i  // LOP client con números
      ];
      
      const requiresVisual = signaturePatterns.some(pattern => 
        pattern.test(fieldLower) || pattern.test(questionLower)
      );
      
      // Guardar en cache incluso el fallback
      this.visualAnalysisCache.set(cacheKey, requiresVisual);
      
      this.logger.warn(`⚠️ Using fallback detection for ${pmcField}: ${requiresVisual}`);
      return requiresVisual;
    }
    
    return false;
  }

  /**
   * NUEVO: Extracción inteligente de texto con detección automática del mejor método
   */
  private async extractTextEnhanced(fileContent: string, filename: string): Promise<string> {
    try {
      this.logger.log(`🧠 Extracción inteligente iniciada para: ${filename}`);
      
      // Convertir base64 a buffer
      const cleanBase64 = fileContent.replace(/^data:application\/pdf;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      const fileSize = buffer.length;
      
      this.logger.log(`📊 Tamaño: ${(fileSize / 1048576).toFixed(2)}MB`);

      // PASO 1: Análisis del tipo de PDF
      const pdfAnalysis = await this.pdfParserService.analyzePdfType(buffer);
      this.logger.log(`🔍 Tipo: ${pdfAnalysis.type} (${(pdfAnalysis.confidence * 100).toFixed(0)}%) - Método: ${pdfAnalysis.analysis.suggestedMethod}`);

      // PASO 2: Extracción según el análisis
      if (fileSize > 52428800) { // 50MB+
        this.logger.log('📦 Archivo muy grande - streaming');
        const streamResult = await this.pdfStreamProcessor.processLargeFile(buffer);
        if (streamResult.success) {
          return streamResult.text;
        }
      } else if (pdfAnalysis.type === 'form' && pdfAnalysis.analysis.filledFieldCount > 0) {
        this.logger.log('📋 Formulario con campos - extractor especializado');
        const formData = await this.pdfFormExtractor.extractFormFields(buffer);
        if (formData.text && formData.text.length > 50) {
          return formData.text;
        }
      } else if (pdfAnalysis.type === 'scanned') {
        this.logger.log('🖼️ Documento escaneado - OCR');
        const hybridResult = await this.pdfHybridAnalyzer.analyzeDocument(
          buffer,
          [],
          { useOcr: true, useVision: false, analyzeSignatures: false }
        );
        if (hybridResult.ocrText && hybridResult.ocrText.length > 50) {
          return hybridResult.ocrText;
        }
      }

      // FALLBACK: usar método actual
      this.logger.log('🔄 Usando método actual como fallback');
      return await this.pdfParserService.extractTextFromBase64(fileContent);

    } catch (error) {
      this.logger.error(`❌ Error en extracción inteligente: ${error.message}`);
      // FALLBACK FINAL: método actual
      this.logger.log('🆘 Fallback final al método actual');
      return await this.pdfParserService.extractTextFromBase64(fileContent);
    }
  }

  /**
   * Función centralizada para obtener el mapeo de variables consistente
   * Usa los nombres exactos que coinciden con la BD
   */
  private getVariableMapping(dto: EvaluateClaimRequestDto, contextData: any): Record<string, any> {
    return {
      // Variables principales - nombres exactos como en la BD
      'insured_name': dto.insured_name || contextData.insured_name,
      'insurance_company': dto.insurance_company || contextData.insurance_company,
      'insured_address': dto.insured_address || contextData.insured_address,
      'insured_street': dto.insured_street || contextData.insured_street,
      'insured_city': dto.insured_city || contextData.insured_city,
      'insured_zip': dto.insured_zip || contextData.insured_zip,
      'date_of_loss': dto.date_of_loss || contextData.date_of_loss,
      'policy_number': dto.policy_number || contextData.policy_number,
      'claim_number': dto.claim_number || contextData.claim_number,
      'type_of_job': dto.type_of_job || contextData.type_of_job,
      'cause_of_loss': dto.cause_of_loss || contextData.cause_of_loss
    };
  }

  /**
   * Prioriza páginas para análisis basándose en el tipo de campo
   */
  private prioritizePages(pageNumbers: number[], pmcField: string): number[] {
    const fieldLower = pmcField.toLowerCase();
    
    // Para campos de firma, priorizar primeras y últimas páginas
    if (fieldLower.includes('sign') || fieldLower.includes('signature')) {
      const first = pageNumbers.slice(0, 2);
      const last = pageNumbers.slice(-2);
      const middle = pageNumbers.slice(2, -2);
      return [...new Set([...first, ...last, ...middle])];
    }
    
    // Para fechas y datos generales, priorizar primeras páginas
    if (fieldLower.includes('date') || fieldLower.includes('policy') || fieldLower.includes('claim')) {
      return pageNumbers; // Mantener orden original (primera a última)
    }
    
    // Por defecto, mantener orden original
    return pageNumbers;
  }

  /**
   * Fallback inteligente mejorado para cuando falla la determinación de estrategia
   */
  private getIntelligentFallbackStrategy(
    pmcField: string,
    question: string,
    expectedType: any
  ): any {
    const fieldLower = pmcField.toLowerCase();
    const questionLower = question.toLowerCase();
    
    // Patrones de análisis mejorado
    const patterns = {
      // Campos de firma - ALTA PRIORIDAD
      signature: {
        patterns: [
          /lop.*sign/i, /signed.*by/i, /sign.*insured/i, /homeowner.*sign/i, 
          /client.*sign/i, /signature/i, /initial/i, /autograph/i
        ],
        strategy: {
          useVisualAnalysis: true,
          useDualValidation: true,
          primaryModel: 'gpt-4o',
          validationModel: 'gpt-4o',
          confidenceThreshold: 0.7,
          reasoning: 'Signature field detected - high priority visual analysis'
        }
      },
      
      // Fechas - MEDIA PRIORIDAD
      dates: {
        patterns: [
          /date/i, /effective/i, /expiration/i, /valid/i, /from/i, /to/i, /period/i
        ],
        strategy: {
          useVisualAnalysis: false,
          useDualValidation: false,
          primaryModel: 'gpt-4o',
          confidenceThreshold: 0.85,
          reasoning: 'Date field - text extraction sufficient'
        }
      },
      
      // Comparaciones/matching - ALTA PRIORIDAD
      matching: {
        patterns: [
          /_match/i, /matching_/i, /compare/i, /verify/i, /confirm/i
        ],
        strategy: {
          useVisualAnalysis: false,
          useDualValidation: true,
          primaryModel: 'gpt-4o',
          validationModel: 'gpt-4o',
          confidenceThreshold: 0.8,
          reasoning: 'Comparison field - requires validation'
        }
      },
      
      // Campos monetarios - MEDIA PRIORIDAD
      monetary: {
        patterns: [
          /amount/i, /cost/i, /price/i, /value/i, /total/i, /deductible/i, /premium/i
        ],
        strategy: {
          useVisualAnalysis: false,
          useDualValidation: true,
          primaryModel: 'gpt-4o',
          confidenceThreshold: 0.85,
          reasoning: 'Monetary field - important for accuracy'
        }
      },
      
      // Información básica - BAJA PRIORIDAD
      basic: {
        patterns: [
          /name/i, /address/i, /city/i, /state/i, /zip/i, /phone/i, /email/i
        ],
        strategy: {
          useVisualAnalysis: false,
          useDualValidation: false,
          primaryModel: 'gpt-4o',
          confidenceThreshold: 0.9,
          reasoning: 'Basic information field - standard processing'
        }
      }
    };
    
    // Buscar el patrón que coincida
    for (const [category, config] of Object.entries(patterns)) {
      const matches = config.patterns.some(pattern => 
        pattern.test(fieldLower) || pattern.test(questionLower)
      );
      
      if (matches) {
        this.logger.log(`🎯 Fallback category detected: ${category} for ${pmcField}`);
        return config.strategy;
      }
    }
    
    // Fallback por tipo de respuesta esperada
    if (expectedType === 'boolean') {
      return {
        useVisualAnalysis: fieldLower.includes('sign'),
        useDualValidation: true,
        primaryModel: 'gpt-4o',
        confidenceThreshold: 0.75,
        reasoning: 'Boolean field - conservative dual validation'
      };
    }
    
    // Fallback general más conservador
    this.logger.warn(`⚠️ No specific pattern matched for ${pmcField}, using conservative fallback`);
    return {
      useVisualAnalysis: false,
      useDualValidation: true,
      primaryModel: 'gpt-4o',
      validationModel: 'gpt-4o',
      confidenceThreshold: 0.8,
      reasoning: 'Conservative fallback - no specific pattern detected'
    };
  }

  /**
   * Determina si una respuesta es mejor que otra basado en el tipo de campo
   */
  private isBetterResponse(newResponse: any, currentBest: any, expectedType: string): boolean {
    // Para campos booleanos (especialmente firmas)
    if (expectedType === 'boolean') {
      // Si la nueva respuesta es YES y la actual es NO, siempre prefiere YES
      if (newResponse.response === 'YES' && currentBest.response === 'NO') {
        return true;
      }
      
      // Si ambas son NO, prefiere la de mayor confianza
      if (newResponse.response === 'NO' && currentBest.response === 'NO') {
        return newResponse.confidence > currentBest.confidence;
      }
      
      // Si ambas son YES, prefiere la de mayor confianza
      if (newResponse.response === 'YES' && currentBest.response === 'YES') {
        return newResponse.confidence > currentBest.confidence;
      }
      
      // Si la nueva es NO y la actual es YES, mantener YES
      return false;
    }
    
    // Para otros tipos de campo, usar lógica de confianza estándar
    return newResponse.confidence > currentBest.confidence;
  }

}