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
import { ResponseType } from './entities/uw-evaluation.entity';

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

          // NUEVO: Determinar si esta pregunta específica necesita análisis visual
          let needsVisual = await this.requiresVisualAnalysis(prompt.pmcField, processedQuestion);
          
          // Si no hay texto y la pregunta lo requiere, forzar análisis visual
          if (!extractedText) {
            this.logger.warn(`No text extracted for ${prompt.pmcField}, forcing visual analysis`);
            needsVisual = true;
          }
          
          let aiResponse;
          
          if (needsVisual && preparedDocument.images && preparedDocument.images.size > 0) {
            // Usar Vision API para preguntas visuales
            this.logger.log(`📸 Using Vision API for: ${prompt.pmcField}`);
            
            // Seleccionar la mejor página para análisis (primera por defecto)
            const pageImage = preparedDocument.images.get(1) || 
                            preparedDocument.images.get(preparedDocument.images.size) || 
                            '';
            
            if (pageImage) {
              aiResponse = await this.openAiService.evaluateWithVision(
                pageImage,
                processedQuestion,
                prompt.expectedType as any,
                prompt.pmcField,
                1 // página analizada
              );
            } else {
              throw new Error('No image available for visual analysis');
            }
          } else {
            // Usar análisis de texto normal
            aiResponse = await this.openAiService.evaluateWithValidation(
              extractedText,
              processedQuestion,
              prompt.expectedType as any,
              undefined,
              prompt.pmcField
            );
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
      
      const variables = {
        'CMS insured': dto.insured_name || contextData.insured_name,
        'Insurance Company': dto.insurance_company || contextData.insurance_company,
        'insured_address': dto.insured_address || contextData.insured_address,
        'insured_street': dto.insured_street || contextData.insured_street,
        'insured_city': dto.insured_city || contextData.insured_city,
        'insured_zip': dto.insured_zip || contextData.insured_zip,
        'date_of_loss': dto.date_of_loss || contextData.date_of_loss,
        'policy_number': dto.policy_number || contextData.policy_number,
        'claim_number': dto.claim_number || contextData.claim_number,
        'type_of_job': dto.type_of_job || contextData.type_of_job
      };

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

}