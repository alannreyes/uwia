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
import { IntelligentPageSelectorService } from './services/intelligent-page-selector.service';
import { LargePdfVisionService } from './services/large-pdf-vision.service';
import { largePdfConfig } from '../../config/large-pdf.config';
import { ProductionLogger } from '../../common/utils/production-logger';
import { EnhancedPdfProcessorService } from './chunking/services/enhanced-pdf-processor.service';
import { ModernRagService } from './services/modern-rag.service';
import { VectorStorageService } from './services/vector-storage.service';
import { SemanticChunkingService } from './services/semantic-chunking.service';
import { Express } from 'express';

// Interface para prompts consolidados de la tabla document_consolidado
interface ConsolidatedPrompt {
  id: number;
  documentName: string;
  question: string;
  expectedType: string;
  promptOrder: number;
  fieldNames: string[];
  expectedFieldsCount: number;
  active: boolean;
  pmcField: string;
}

@Injectable()
export class UnderwritingService {
  private readonly logger = new Logger(UnderwritingService.name);
  private readonly prodLogger = new ProductionLogger(UnderwritingService.name);
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
    private pageSelector: IntelligentPageSelectorService,
    private largePdfVision: LargePdfVisionService,
    private enhancedPdfProcessorService: EnhancedPdfProcessorService,
  private modernRagService: ModernRagService,
  private vectorStorageService: VectorStorageService,
  private semanticChunkingService: SemanticChunkingService,
  ) {}

  private getVariableMapping(dto: any, contextData: any): Record<string, string> {
    return {
      '%insured_name%': dto.insured_name || contextData?.insured_name || '',
      '%insurance_company%': dto.insurance_company || contextData?.insurance_company || '',
      '%insured_address%': dto.insured_address || contextData?.insured_address || '',
      '%insured_street%': dto.insured_street || contextData?.insured_street || '',
      '%insured_city%': dto.insured_city || contextData?.insured_city || '',
      '%insured_zip%': dto.insured_zip || contextData?.insured_zip || '',
      '%date_of_loss%': dto.date_of_loss || contextData?.date_of_loss || '',
      '%policy_number%': dto.policy_number || contextData?.policy_number || '',
      '%claim_number%': dto.claim_number || contextData?.claim_number || '',
      '%type_of_job%': dto.type_of_job || contextData?.type_of_job || '',
      '%cause_of_loss%': dto.cause_of_loss || contextData?.cause_of_loss || '',
    };
  }

  private replaceVariablesInPrompt(prompt: string, variables: Record<string, string>): string {
    let replacedPrompt = prompt;
    for (const key in variables) {
      replacedPrompt = replacedPrompt.replace(new RegExp(key, 'g'), variables[key]);
    }
    return replacedPrompt;
  }

  async processLargeFileSynchronously(
    file: Express.Multer.File,
    body: any,
  ): Promise<EvaluateClaimResponseDto> {
    const { record_id, document_name, context } = body;

    this.logger.log(`[SYNC-LARGE] Starting synchronous processing for ${file.originalname}`);

    try {
      // 1. Procesar y almacenar el archivo en la base de datos
      const session = await this.enhancedPdfProcessorService.processLargePdf({
        buffer: file.buffer,
        originalname: file.originalname,
        size: file.size
      });

      this.logger.log(`[SYNC-LARGE] File stored with session ID: ${session.id}`);

      // 2. Obtener el prompt para este documento
      const documentPrompts = await this.documentPromptRepository.find({
        where: { documentName: `${document_name}.pdf`, active: true },
        order: { promptOrder: 'ASC' },
      });

      if (documentPrompts.length === 0) {
        throw new Error(`No active prompts found for document: ${document_name}.pdf`);
      }
      const prompt = documentPrompts[0];
      const question = this.replaceVariablesInPrompt(prompt.question, this.getVariableMapping(body, context));

      // 3. Esperar a que la sesión esté lista para consultas
      this.logger.log(`[SYNC-LARGE] Waiting for session ${session.id} to be ready...`);
      await this.waitForSessionReady(session.id);
      this.logger.log(`[SYNC-LARGE] Session ${session.id} is ready. Processing chunks for RAG system...`);

      // 3.5. Ahora que la sesión está lista, procesar chunks para RAG
      this.logger.log(`🔄 [RAG-INTEGRATION] Processing document chunks for RAG system...`);
      try {
        // Obtener chunks procesados de la sesión (ahora que sabemos que existen)
        const processedChunks = await this.enhancedPdfProcessorService.getProcessedChunks(session.id);
        this.logger.log(`📦 [RAG-INTEGRATION] Found ${processedChunks.length} chunks to process for RAG`);
        
        if (processedChunks.length > 0) {
          // Convertir chunks a formato semántico
          const semanticChunks = await this.semanticChunkingService.convertChunksToSemantic(
            processedChunks, 
            session.id, 
            file.originalname
          );
          
          // Almacenar embeddings en el vector storage
          await this.vectorStorageService.storeEmbeddings(semanticChunks);
          
          this.logger.log(`✅ [RAG-INTEGRATION] Successfully stored ${semanticChunks.length} chunks in vector storage`);
        } else {
          this.logger.warn(`⚠️ [RAG-INTEGRATION] No processed chunks found for session ${session.id}`);
        }
      } catch (error) {
        this.logger.error(`❌ [RAG-INTEGRATION] Failed to process chunks for RAG: ${error.message}`);
        // Continue processing - RAG integration failure shouldn't stop document processing
      }

      // 4. Ejecutar la consulta RAG moderna y esperar la respuesta
      this.logger.log(`🚀 [RAG-INTEGRATION] Initiating RAG pipeline for question processing...`);
      this.logger.log(`📝 [RAG-INTEGRATION] Question: "${question.substring(0, 200)}..."`);
      
      const ragResult = await this.modernRagService.executeRAGPipeline(question, session.id);
  
  this.logger.log(`✅ [RAG-INTEGRATION] RAG pipeline completed successfully`);
  this.logger.log(`📊 [RAG-INTEGRATION] Answer received: ${ragResult.answer ? ragResult.answer.length + ' chars' : 'empty'}`);
  this.logger.log(`📚 [RAG-INTEGRATION] Sources used: ${ragResult.sources?.length || 0}`);

      // 4. Formatear la respuesta para que coincida con la estructura esperada
      const pmcResult: PMCFieldResultDto = {
        pmc_field: prompt.pmcField,
        question: prompt.question,
        answer: ragResult.answer,
        confidence: 1, // TODO: Ajustar según modernRagService
        expected_type: 'text',
        // processing_time: ragResult.processingTime, // TODO: Implementar si es necesario
        // error: ragResult.error, // TODO: Implementar si es necesario
      };

      const results = {
        [`${document_name}.pdf`]: [pmcResult],
      };

      return {
        record_id: record_id,
        status: 'success',
        results,
        summary: {
          total_documents: 1,
          processed_documents: 1,
          total_fields: 1,
          answered_fields: 1, // TODO: Ajustar lógica según modernRagService
        },
        processed_at: new Date(),
      };
    } catch (error) {
      this.logger.error(`[SYNC-LARGE] Error during synchronous large file processing: ${error.message}`, error.stack);
      throw new HttpException(
        `Failed to process large file synchronously: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async evaluateClaim(dto: EvaluateClaimRequestDto): Promise<EvaluateClaimResponseDto> {
    const startTime = Date.now();
    const results: Record<string, any[]> = {};
    const errors: string[] = [];
    let totalFields = 0;
    let answeredFields = 0;

    try {
      // Processing claim
      
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

      // Inicio del procesamiento con información básica
      const summary = this.prodLogger.createSummary();
      
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
      
      // Log de inicio con información del documento
      const providerName = dto.context ? 
        (typeof dto.context === 'string' ? JSON.parse(dto.context)?.provider_name : dto.context?.provider_name) || 'Unknown' 
        : 'Unknown';
      this.prodLogger.documentStart(documentToProcess, 0, providerName, documentPrompts.length);
      
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
        this.prodLogger.error(documentToProcess, 'document_processing', 'UnderwritingService', error.message);
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

      // Log de finalización con resumen
      const duration = summary.getDuration();
      const errorCount = errors.length;
      const warningCount = 0; // TODO: Implementar contador de warnings
      this.prodLogger.documentEnd(documentToProcess, duration, answeredFields, totalFields, errorCount, warningCount);

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
    
    // SAFETY CHECK: Detección temprana de archivos extremadamente grandes
    const EXTREME_FILE_LIMIT_MB = 50; // REDUCIDO: Límite para archivos extremos (era 150)
    const SAFE_PROCESSING_LIMIT_MB = 30; // REDUCIDO: Límite seguro (era 100)
    let MAX_PROCESSING_TIME_MS = 300000; // REDUCIDO: 5 minutos máximo (era 8) - cambié a let
    const processStartTime = Date.now();
    let isExtremeLargeFile = false;
    let fileSizeEstimate = 0;
    
    // Estimar tamaño del archivo si está disponible
    if (pdfContent) {
      // Base64 a bytes: length * 0.75 aproximadamente
      fileSizeEstimate = (pdfContent.length * 0.75) / (1024 * 1024); // MB
      
      // CRITICAL: Si el archivo es más de 50MB, FORZAR truncación
      isExtremeLargeFile = fileSizeEstimate > EXTREME_FILE_LIMIT_MB;
      
      // SPECIAL CASE: POLICY files > 30MB siempre son extremos
      if (documentName.toUpperCase().includes('POLICY') && fileSizeEstimate > 30) {
        isExtremeLargeFile = true;
        this.logger.error(`🚨 POLICY FILE DETECTED: ${fileSizeEstimate.toFixed(2)}MB - FORCING EXTREME MODE`);
      }
      
      if (isExtremeLargeFile) {
        this.logger.error(`🚨 EXTREME LARGE FILE DETECTED: ${documentName} (~${fileSizeEstimate.toFixed(2)}MB)`);
        this.logger.error(`🔧 ACTIVATING AGGRESSIVE TRUNCATION to prevent crashes`);
      } else if (fileSizeEstimate > SAFE_PROCESSING_LIMIT_MB) {
        this.logger.warn(`⚠️ Large file detected: ${documentName} (~${fileSizeEstimate.toFixed(2)}MB)`);
        this.logger.warn(`🔧 Activating timeout protection mode`);
      }
    }

    try {
      // 1. Obtener prompt consolidado configurado para este documento
      // Query the document_consolidado table directly using raw SQL
      const connection = this.documentPromptRepository.manager.connection;
      const queryRunner = connection.createQueryRunner();
      
      try {
        await queryRunner.connect();
        
        // DEBUG: First, let's see ALL available documents in the table
        const allDocsQuery = `SELECT id, document_name, active, expected_fields_count FROM document_consolidado ORDER BY document_name`;
        const allDocs = await queryRunner.query(allDocsQuery);
        
        this.logger.log(`📋 ALL DOCUMENTS in document_consolidado table (${allDocs?.length || 0} total):`);
        if (allDocs && allDocs.length > 0) {
          allDocs.forEach((doc, index) => {
            this.logger.log(`   ${index + 1}. ID:${doc.id} | ${doc.document_name} | Active:${doc.active} | Fields:${doc.expected_fields_count}`);
          });
        } else {
          this.logger.error(`❌ NO DOCUMENTS FOUND IN document_consolidado TABLE!`);
        }
        
        // DEBUG: Log the query being executed
        const query = `SELECT * FROM document_consolidado WHERE document_name = ? AND active = true LIMIT 1`;
        this.logger.log(`🔍 Now searching for specific document: "${documentName}"`);
        this.logger.log(`   SQL: ${query}`);
        this.logger.log(`   Parameters: [${documentName}]`);
        
        // Use proper parameter syntax for MySQL (? instead of $1)
        const result = await queryRunner.query(query, [documentName]);
        
        // DEBUG: Log query result
        this.logger.log(`📊 Query result for ${documentName}:`);
        this.logger.log(`   - Found records: ${result?.length || 0}`);
        if (result && result.length > 0) {
          this.logger.log(`   - Record ID: ${result[0]?.id}`);
          this.logger.log(`   - Document name: ${result[0]?.document_name}`);
          this.logger.log(`   - Has question: ${!!result[0]?.question}`);
          this.logger.log(`   - Field names: ${result[0]?.field_names}`);
          this.logger.log(`   - Expected fields count: ${result[0]?.expected_fields_count}`);
          this.logger.log(`   - Active: ${result[0]?.active}`);
        }
        
        if (!result || result.length === 0) {
          // DEBUG: Try different variations to see if it's a string matching issue
          this.logger.warn(`⚠️ Document "${documentName}" not found. Testing variations:`);
          
          // Test case variations
          const variations = [
            documentName.toLowerCase(),
            documentName.toUpperCase(),
            documentName.trim(),
            documentName + '.pdf',
            documentName.replace('.pdf', ''),
          ];
          
          for (const variation of variations) {
            if (variation !== documentName) {
              const testQuery = `SELECT document_name FROM document_consolidado WHERE document_name = ? AND active = true LIMIT 1`;
              const testResult = await queryRunner.query(testQuery, [variation]);
              this.logger.log(`   Testing "${variation}": ${testResult?.length > 0 ? 'FOUND' : 'NOT FOUND'}`);
            }
          }
          
          this.logger.warn(`⚠️ No consolidated prompt configured for document: ${documentName} - returning SKIPPED result`);
          return [{
            pmc_field: 'document_not_configured',
            question: `Document ${documentName} not configured in system`,
            answer: 'SKIPPED',
            confidence: 0,
            processing_time: 0,
            error: `No consolidated prompt configured for document: ${documentName}`
          }];
        }

        const rawPrompt = result[0];
        
        // Transform the raw result to match our interface
        const documentPrompt: ConsolidatedPrompt = {
          id: rawPrompt.id,
          documentName: rawPrompt.document_name,
          question: rawPrompt.question,
          expectedType: rawPrompt.expected_type,
          promptOrder: rawPrompt.prompt_order,
          fieldNames: typeof rawPrompt.field_names === 'string' 
            ? JSON.parse(rawPrompt.field_names) 
            : rawPrompt.field_names,
          expectedFieldsCount: rawPrompt.expected_fields_count,
          active: rawPrompt.active,
          pmcField: rawPrompt.pmc_field
        };

        // Process with consolidated prompt
        this.logger.log(`📋 Processing ${documentName} with consolidated prompt:`);
        this.logger.log(`   - Expected fields: ${documentPrompt.expectedFieldsCount}`);
        this.logger.log(`   - Field names: [${documentPrompt.fieldNames.join(', ')}]`);
        this.logger.log(`   - Question prompt length: ${documentPrompt.question?.length || 0} chars`);
        this.logger.log(`   - First 200 chars of prompt: ${documentPrompt.question?.substring(0, 200) || 'NO PROMPT'}`);
        
        // TRUNCATION STRATEGY para archivos extremos
        if (isExtremeLargeFile) {
          // Para archivos extremos, reducir timeout agresivamente
          if (fileSizeEstimate > 80) {
            MAX_PROCESSING_TIME_MS = 120000; // Solo 2 minutos
            this.logger.error(`🚨 ULTRA LARGE FILE (${fileSizeEstimate.toFixed(2)}MB): Timeout reduced to 2 minutes`);
          } else {
            MAX_PROCESSING_TIME_MS = 180000; // 3 minutos para archivos grandes
          }
        }

        // 2. Procesar documento con prompt consolidado
        const consolidatedResults = await this.processDocumentWithConsolidatedPrompt(
          recordId,
          documentName,
          documentPrompt,
          pdfContent,
          variables,
          isExtremeLargeFile,
          MAX_PROCESSING_TIME_MS
        );
        
        return consolidatedResults;
        
      } finally {
        await queryRunner.release();
      }

    } catch (error) {
      this.logger.error(`Error in processDocumentWithContent: ${error.message}`);
      throw error;
    }
  }

  private async processDocumentWithConsolidatedPrompt(
    recordId: string,
    documentName: string,
    documentPrompt: ConsolidatedPrompt,
    pdfContent: string | null,
    variables: Record<string, string>,
    isExtremeLargeFile: boolean,
    maxProcessingTimeMs: number
  ): Promise<any[]> {
    const results: any[] = [];
    const processStartTime = Date.now();

    try {
      if (!pdfContent) {
        this.logger.warn(`No PDF content provided for ${documentName}`);
        const notFoundAnswers = Array(documentPrompt.fieldNames.length).fill('NOT_FOUND').join(';');
        return [{
          pmc_field: documentPrompt.pmcField,
          question: documentPrompt.question,
          answer: notFoundAnswers,
          confidence: 0,
          processing_time_ms: 0,
          error: 'No PDF content provided'
        }];
      }

      // Determinar estrategia de procesamiento según documento
      const shouldUseChunking = this.shouldUseChunkingStrategy(documentName, documentPrompt.expectedFieldsCount);
      
      if (shouldUseChunking) {
        this.logger.log(`🧩 Using CHUNKING strategy for ${documentName} (${documentPrompt.expectedFieldsCount} fields)`);
        return await this.processWithChunking(recordId, documentName, documentPrompt, pdfContent, variables, isExtremeLargeFile);
      }

      this.logger.log(`📦 Using CONSOLIDATED strategy for ${documentName} (${documentPrompt.expectedFieldsCount} fields)`);

      // Preparar documento para análisis
      const documentNeeds = { needsVisual: true, needsText: true };
      
      // MEJORADO: Usar truncación menos agresiva para documentos que necesitan visual
      const truncationLimit = documentName.toUpperCase().includes('LOP') || 
                              documentName.toUpperCase().includes('ROOF') ? 100 : 50;
      
      const preparedDocument = isExtremeLargeFile 
        ? await this.prepareDocumentWithTruncation(pdfContent, documentNeeds, truncationLimit)
        : await this.prepareDocument(pdfContent, documentNeeds, documentName);
      
      this.logger.log(`📑 Document preparation for ${documentName}: truncation=${isExtremeLargeFile}, limit=${truncationLimit}`);

      // Reemplazar variables dinámicas en el prompt consolidado
      let processedPrompt = documentPrompt.question;
      Object.entries(variables).forEach(([key, value]) => {
        const placeholder = `%${key}%`;
        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        processedPrompt = processedPrompt.replace(new RegExp(escapedPlaceholder, 'g'), value);
      });

      this.logger.log(`🤖 Processing ${documentName} with consolidated prompt (expecting ${documentPrompt.expectedFieldsCount} fields)`);

      // LOGGING: Información sobre el documento preparado
      // Calcular tamaño estimado del archivo
      const fileSizeEstimate = pdfContent ? (pdfContent.length * 0.75) / (1024 * 1024) : 0;
      
      this.logger.log(`📄 Document ${documentName} preparation results:`);
      this.logger.log(`   - Text extracted: ${preparedDocument.text ? preparedDocument.text.length + ' chars' : 'NO'}`);
      this.logger.log(`   - Images available: ${preparedDocument.images ? preparedDocument.images.size + ' pages' : 'NO'}`);
      this.logger.log(`   - Is extreme file: ${isExtremeLargeFile}`);
      this.logger.log(`   - File size estimate: ${fileSizeEstimate.toFixed(2)}MB`);

      // Determinar estrategia de procesamiento
      const strategy = await this.adaptiveStrategy.determineStrategy(
        documentPrompt.pmcField || 'consolidated',
        processedPrompt,
        ResponseType.TEXT,
        preparedDocument.images && preparedDocument.images.size > 0
      );

      // FORZAR análisis visual solo para documentos que realmente lo necesitan
      // TEMP FIX: Removiendo LOP y CERTIFICATE para usar análisis de texto
      const forceVisualDocuments = ['ROOF', 'INVOICES'];
      const shouldForceVisual = forceVisualDocuments.some(doc => 
        documentName.toUpperCase().includes(doc)
      );

      let useVisualAnalysis = strategy.useVisualAnalysis || shouldForceVisual;
      
      // LOGGING: Decisión de estrategia
      this.logger.log(`🎯 Strategy decision for ${documentName}:`);
      this.logger.log(`   - Original strategy: Visual=${strategy.useVisualAnalysis}, Model=${strategy.primaryModel}`);
      this.logger.log(`   - Force visual: ${shouldForceVisual}`);
      this.logger.log(`   - Final decision: Visual=${useVisualAnalysis}`);

      // Ejecutar SIEMPRE TEXTO y, si hay imágenes, VISIÓN, y fusionar por campo
      const runVision = useVisualAnalysis && preparedDocument.images && preparedDocument.images.size > 0;
      const runText = !!preparedDocument.text && preparedDocument.text.length > 0;

      let visionAnswer: string | null = null;
      let visionConf = 0;
      let visionTime = 0;
      let textAnswer: string | null = null;
      let textConf = 0;

      const promises: Promise<any>[] = [];
      if (runVision) {
        this.logger.log(`🔍 Using CONSOLIDATED VISUAL ANALYSIS for ${documentName} with ${preparedDocument.images.size} pages`);
        this.logger.log(`🏗️ Processing with NEW consolidated method - expecting ${documentPrompt.fieldNames.length} fields in one response`);
        const p = this.largePdfVision.processConsolidatedPromptWithVision(
          {
            pmc_field: documentPrompt.pmcField,
            question: processedPrompt,
            expected_fields: documentPrompt.fieldNames,
            expected_type: ResponseType.TEXT
          },
          Array.from(preparedDocument.images.values()).map(img => Buffer.from(img as string, 'base64')),
          preparedDocument.text || '',
          fileSizeEstimate
        ).then(res => {
          visionAnswer = res.answer;
          visionConf = res.confidence || 0;
          visionTime = res.processing_time_ms || 0;
          this.logger.log(`🔍 CONSOLIDATED visual analysis result: "${res.answer}" (conf: ${res.confidence})`);
        }).catch(err => {
          this.logger.warn(`⚠️ Visual analysis failed: ${err.message}`);
        });
        promises.push(p);
      }

      if (runText) {
        const p = this.openAiService.evaluateWithValidation(
          preparedDocument.text || '',
          processedPrompt,
          ResponseType.TEXT,
          undefined,
          documentPrompt.pmcField
        ).then(res => {
          textAnswer = res.response;
          textConf = res.final_confidence || res.confidence || 0;
          this.logger.log(`📝 CONSOLIDATED text analysis result: "${res.response}" (conf: ${textConf})`);
        }).catch(err => {
          this.logger.warn(`⚠️ Text analysis failed: ${err.message}`);
        });
        promises.push(p);
      }

      if (promises.length === 0) {
        throw new Error('No analysis path available (neither text nor vision)');
      }
      await Promise.allSettled(promises);

      // Asegurar respuestas en el tamaño correcto
      const visionArr = visionAnswer ? this.parseConsolidatedResponse(visionAnswer, documentPrompt.fieldNames) : null;
      const textArr = textAnswer ? this.parseConsolidatedResponse(textAnswer, documentPrompt.fieldNames) : null;

      // Fusión por campo con reglas: preferir no-NOT_FOUND; YES gana a NO; para address/date/policy/claim preferir texto
      const preferTextSubstrings = ['street', 'zip', 'city', 'state', 'date', 'policy_number', 'claim_number'];
      const booleanHint = (fname: string) => fname.includes('sign') || fname.endsWith('_match') || fname === 'mechanics_lien';
      const takeTextFor = (fname: string) => preferTextSubstrings.some(s => fname.includes(s));

      const combinedValues: string[] = [];
      for (let i = 0; i < documentPrompt.fieldNames.length; i++) {
        const fname = documentPrompt.fieldNames[i];
        const v = visionArr ? (visionArr[i] || 'NOT_FOUND') : 'NOT_FOUND';
        const t = textArr ? (textArr[i] || 'NOT_FOUND') : 'NOT_FOUND';

        let chosen = 'NOT_FOUND';

        if (booleanHint(fname)) {
          // YES tiene prioridad; si ninguno YES, usar NO si está presente
          if (t === 'YES' || v === 'YES') chosen = 'YES';
          else if (t === 'NO' || v === 'NO') chosen = 'NO';
          else chosen = (t !== 'NOT_FOUND') ? t : v;
        } else {
          if (t !== 'NOT_FOUND' && v === 'NOT_FOUND') chosen = t;
          else if (v !== 'NOT_FOUND' && t === 'NOT_FOUND') chosen = v;
          else if (t !== 'NOT_FOUND' && v !== 'NOT_FOUND') {
            if (takeTextFor(fname)) {
              chosen = t.length >= v.length ? t : t; // preferir texto
            } else {
              // elegir el más informativo (más largo) como aproximación
              chosen = (v.length > t.length) ? v : t;
            }
          } else {
            chosen = 'NOT_FOUND';
          }
        }
        combinedValues.push((chosen || '').toString().trim());
      }

      const responseText = combinedValues.join(';');
      
      // LOGGING: Respuesta recibida
      this.logger.log(`📊 Response received for ${documentName}:`);
      this.logger.log(`   - Response length: ${responseText ? responseText.length : 0} chars`);
      this.logger.log(`   - First 200 chars: ${responseText ? responseText.substring(0, 200) : 'NO RESPONSE'}`);
      this.logger.log(`   - Response type: ${typeof responseText}`);
      
      // Para respuestas consolidadas, la respuesta ya debería venir en formato correcto
      let finalAnswer: string;
      let finalConfidence: number;
      let actualProcessingTime: number;
      
      // Calcular métricas y confianza del resultado combinado
      const fieldValues = this.parseConsolidatedResponse(responseText, documentPrompt.fieldNames);
      this.logger.log(`📋 Parsed values for ${documentName}:`);
      this.logger.log(`   - Expected fields: ${documentPrompt.fieldNames.length}`);
      this.logger.log(`   - Parsed values: ${fieldValues.length}`);
      this.logger.log(`   - Values with content: ${fieldValues.filter(v => v && v !== 'NOT_FOUND').length}`);

      finalAnswer = fieldValues.join(';');
      const foundFields = fieldValues.filter(value => value !== 'NOT_FOUND').length;
      // Confianza: combinar aportes de texto y visión si existen; si no, proporción encontrada
      const baseConf = Math.max(textConf, visionConf);
      finalConfidence = baseConf > 0 ? baseConf : (foundFields / Math.max(1, fieldValues.length));
      actualProcessingTime = Math.max(visionTime, Date.now() - processStartTime);

      // Post-proceso: recalcular campos *_match con lógica programática para mayor exactitud
      try {
        const recalculated = this.recalculateMatches(finalAnswer, documentPrompt.fieldNames, variables);
        if (recalculated) {
          finalAnswer = recalculated;
        }
      } catch (ppErr) {
        this.logger.warn(`⚠️ Post-processing of *_match fields failed: ${ppErr.message}`);
      }

      // Post-proceso complementario: mechanics_lien basado en evidencia textual (solo si AI dijo NO/NOT_FOUND)
      try {
        const idxLien = documentPrompt.fieldNames.findIndex(f => f === 'mechanics_lien');
        if (idxLien >= 0 && preparedDocument?.text) {
          const parts = finalAnswer.split(';');
          const current = (parts[idxLien] || '').trim().toUpperCase();
          if (current === 'NO' || current === 'NOT_FOUND') {
            const detected = this.detectMechanicsLien(preparedDocument.text);
            if (detected) {
              parts[idxLien] = 'YES';
              const updated = parts.join(';');
              if (updated !== finalAnswer) {
                this.logger.log('🧭 Post-check mechanics_lien: AI=NO/NOT_FOUND pero texto evidencia LIEN → Ajustando a YES');
                finalAnswer = updated;
              }
            }
          }
        }
      } catch (ppErr) {
        this.logger.warn(`⚠️ Post-processing mechanics_lien check failed: ${ppErr.message}`);
      }

      // Crear UNA SOLA respuesta consolidada
      results.push({
        pmc_field: documentPrompt.pmcField,
        question: processedPrompt,
        answer: finalAnswer,
        confidence: finalConfidence,
        processing_time_ms: actualProcessingTime,
        error: null
      });
      
      this.logger.log(`✅ FINAL RESULT for ${documentName}:`);
      this.logger.log(`   - pmc_field: "${documentPrompt.pmcField}"`);
      this.logger.log(`   - answer length: ${finalAnswer.length} chars`);
      this.logger.log(`   - answer split: ${finalAnswer.split(';').length} values`);
      this.logger.log(`   - confidence: ${finalConfidence}`);
      this.logger.log(`   - First 100 chars of answer: "${finalAnswer.substring(0, 100)}..."`);
      
      // Verificación final - CRITICAL VALIDATION
      const answerParts = finalAnswer.split(';');
      if (answerParts.length !== documentPrompt.fieldNames.length) {
        this.logger.warn(`⚠️ FINAL VALIDATION WARNING:`);
        this.logger.warn(`   Expected ${documentPrompt.fieldNames.length} values, got ${answerParts.length}`);
        this.logger.warn(`   Expected fields: [${documentPrompt.fieldNames.join(', ')}]`);
        this.logger.warn(`   Got values: [${answerParts.join(', ')}]`);
      } else {
        this.logger.log(`✅ FINAL VALIDATION PASSED: ${answerParts.length} values match ${documentPrompt.fieldNames.length} expected fields`);
      }

      // Guardar evaluación consolidada en BD - DESHABILITADO temporalmente por incompatibilidad de FK
      /*
      try {
        await this.claimEvaluationRepository.save({
          claimReference: recordId,
          documentName: documentName,
          promptId: documentPrompt.id,
          question: processedPrompt,
          response: consolidatedAnswer,
          confidence: confidence,
          processingTimeMs: processingTime,
          errorMessage: null
        });
      } catch (saveError) {
        this.logger.error(`Failed to save consolidated evaluation: ${saveError.message}`);
      }
      */

      return results;

    } catch (error) {
      this.logger.error(`Error processing consolidated prompt for ${documentName}: ${error.message}`);
      
      // Retornar resultado de error consolidado
      const errorAnswers = Array(documentPrompt.fieldNames.length).fill('ERROR').join(';');
      return [{
        pmc_field: documentPrompt.pmcField,
        question: documentPrompt.question,
        answer: errorAnswers,
        confidence: 0,
        processing_time_ms: Date.now() - processStartTime,
        error: error.message
      }];
    }
  }

  /**
   * Detección textual robusta de referencias a LIEN (evita falsos positivos como "client")
   */
  private detectMechanicsLien(text: string): boolean {
    if (!text) return false;
    const t = text.toLowerCase();
    const patterns: RegExp[] = [
      /\bmechanic'?s?\s+lien(s)?\b/i,
      /\bconstruction\s+lien\b/i,
      /\blien\s+upon\b/i,
      /\blien\s+(right|rights)\b/i,
      /\bsecurity\s+interest\b/i,
      /\bconstruction\s+lien\s+law\b/i,
      /\bletter\s+of\s+protection\b.*\blien\b/i,
      /\blien\b\s+upon\s+(any\s+and\s+all\s+)?proceeds?/i,
    ];
    // Primero, patrones estrictos con límites de palabra (evita "client")
    for (const re of patterns) {
      if (re.test(t)) return true;
    }
    // Como último recurso, si hay muchas ocurrencias de "\blien\b" y "proceeds", también considerarlo
    const lienCount = (t.match(/\blien\b/gi) || []).length;
    const proceedsCount = (t.match(/\bproceeds?\b/gi) || []).length;
    if (lienCount >= 2 && proceedsCount >= 1) return true;
    return false;
  }

  /**
   * Recalcula campos *_match de forma determinística usando variables de contexto
   */
  private recalculateMatches(
    answer: string,
    fieldNames: string[],
    variables: Record<string, string>
  ): string | null {
    if (!answer) return null;
    const parts = answer.split(';');
    if (parts.length !== fieldNames.length) return null;

    // Helpers de normalización
    const norm = (s?: string) => (s || '')
      .toString()
      .normalize('NFKD')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const normAlnum = (s?: string) => norm(s).replace(/[^a-z0-9]/g, '');
    const normDigits = (s?: string) => (s || '').toString().replace(/\D+/g, '');

    // Construir mapa campo->indice
    const indexOf = (name: string) => fieldNames.findIndex(f => f === name);

    // Valores extraídos base
    const streetVal = parts[indexOf('onb_street1')] || '';
    const zipVal = parts[indexOf('onb_zip1')] || '';
    const cityVal = parts[indexOf('onb_city1')] || '';
    const stateVal = parts[indexOf('state1')] || '';
    const dolVal = parts[indexOf('onb_date_of_loss1')] || '';
    const policyVal = parts[indexOf('onb_policy_number1')] || '';
    const claimVal = parts[indexOf('onb_claim_number1')] || '';

    // Variables de referencia
    const vStreet = variables['insured_street'] || variables['insured_address'];
    const vZip = variables['insured_zip'];
    const vCity = variables['insured_city'];
    const vAddress = variables['insured_address'];
    const vDol = variables['date_of_loss'];
    const vPolicy = variables['policy_number'];
    const vClaim = variables['claim_number'];

    // Reglas de comparación
    const eq = (a: string, b: string) => normAlnum(a) === normAlnum(b);
    const eqDigits = (a: string, b: string) => normDigits(a) === normDigits(b);
    const eqLoose = (a: string, b: string) => {
      const A = norm(a);
      const B = norm(b);
      if (!A || !B) return false;
      if (A === B) return true;
      // contener recíproco ayuda para abreviaturas menores
      return A.includes(B) || B.includes(A);
    };

    const setIfExists = (field: string, value: 'YES' | 'NO') => {
      const idx = indexOf(field);
      if (idx >= 0) parts[idx] = value;
    };

    // onb_street_match
    if (indexOf('onb_street_match') >= 0 && (streetVal || vStreet)) {
      setIfExists('onb_street_match', eqLoose(streetVal, vStreet) ? 'YES' : 'NO');
    }
    // onb_zip_match
    if (indexOf('onb_zip_match') >= 0 && (zipVal || vZip)) {
      setIfExists('onb_zip_match', eqDigits(zipVal, vZip) ? 'YES' : 'NO');
    }
    // onb_city_match
    if (indexOf('onb_city_match') >= 0 && (cityVal || vCity)) {
      setIfExists('onb_city_match', eqLoose(cityVal, vCity) ? 'YES' : 'NO');
    }
    // onb_address_match: comparar dirección completa con normalización específica
    // Mantener state1 tal cual (p.ej. "FL Florida") en la respuesta, pero para VALIDACIÓN usar solo la abreviatura de 2 letras.
    if (indexOf('onb_address_match') >= 0 && vAddress) {
      // Extrae abreviatura de estado a partir de state1 (p.ej., "FL Florida" -> "FL")
      const stateAbbrevFrom = (s: string) => {
        const m = (s || '').toString().trim().match(/^([A-Za-z]{2})\b/);
        return m ? m[1].toUpperCase() : '';
      };

      // Comparación específica para direcciones: remover puntuación y espacios, comparar por inclusión/equivalencia
      const eqAddress = (a: string, b: string) => {
        const A = normAlnum(a);
        const B = normAlnum(b);
        return A === B || A.includes(B) || B.includes(A);
      };

      // Construir dirección extraída usando solo la abreviatura de estado para la comparación
      const extractedStateAbbrev = stateAbbrevFrom(stateVal) || stateVal;
      const extractedAddressForMatch = [
        streetVal,
        cityVal,
        extractedStateAbbrev,
        normDigits(zipVal)
      ].filter(Boolean).join(' ');

      setIfExists('onb_address_match', eqAddress(extractedAddressForMatch, vAddress) ? 'YES' : 'NO');
    }
    // onb_date_of_loss_match
    if (indexOf('onb_date_of_loss_match') >= 0 && (dolVal || vDol)) {
      setIfExists('onb_date_of_loss_match', eqDigits(dolVal, vDol) ? 'YES' : 'NO');
    }
    // onb_policy_number_match
    if (indexOf('onb_policy_number_match') >= 0 && (policyVal || vPolicy)) {
      setIfExists('onb_policy_number_match', eq(policyVal, vPolicy) ? 'YES' : 'NO');
    }
    // onb_claim_number_match
    if (indexOf('onb_claim_number_match') >= 0 && (claimVal || vClaim)) {
      setIfExists('onb_claim_number_match', eq(claimVal, vClaim) ? 'YES' : 'NO');
    }

    return parts.join(';');
  }


  private parseConsolidatedResponse(responseText: string, fieldNames: string[]): string[] {
    // Coerción defensiva: asegurar string para evitar errores como "responseText.split is not a function"
    if (typeof (responseText as any) !== 'string') {
      try {
        responseText = String(responseText ?? '');
      } catch {
        responseText = '';
      }
    }
    this.logger.debug(`🔍 [parseConsolidatedResponse] Raw AI response: "${responseText}"`);
    this.logger.debug(`🔍 [parseConsolidatedResponse] Expected fields: ${JSON.stringify(fieldNames)}`);
    this.logger.debug(`🔍 [parseConsolidatedResponse] Expected field count: ${fieldNames.length}`);
    
    // El prompt consolidado especifica que la respuesta debe venir con semicolons como separadores
    const parts = responseText.split(';').map(part => part.trim());
    this.logger.debug(`🔍 [parseConsolidatedResponse] Split parts: ${JSON.stringify(parts)}`);
    this.logger.debug(`🔍 [parseConsolidatedResponse] Parts count: ${parts.length}`);
    
    // Si tenemos el número exacto de partes esperadas, las devolvemos
    if (parts.length === fieldNames.length) {
      this.logger.debug(`🔍 [parseConsolidatedResponse] ✅ Perfect match - returning parts as-is`);
      const result = parts.map((part, index) => {
        this.logger.debug(`🔍 [parseConsolidatedResponse] Field[${index}] "${fieldNames[index]}" = "${part}"`);
        return part;
      });
      return result;
    }
    
    // Si no, intentar extraer línea por línea o buscar patrones específicos
    this.logger.warn(`🔍 [parseConsolidatedResponse] ⚠️ Mismatch: Expected ${fieldNames.length} fields but got ${parts.length} parts from consolidated response`);
    this.logger.warn(`🔍 [parseConsolidatedResponse] Raw response was: "${responseText}"`);
    
    // Completar con NOT_FOUND si faltan campos
    const result = [...parts];
    while (result.length < fieldNames.length) {
      this.logger.debug(`🔍 [parseConsolidatedResponse] Adding NOT_FOUND for missing field`);
      result.push('NOT_FOUND');
    }
    
    const finalResult = result.slice(0, fieldNames.length); // Truncar si hay más de los esperados
    this.logger.debug(`🔍 [parseConsolidatedResponse] Final result: ${JSON.stringify(finalResult)}`);
    finalResult.forEach((value, index) => {
      this.logger.debug(`🔍 [parseConsolidatedResponse] Final[${index}] "${fieldNames[index]}" = "${value}"`);
    });
    
    return finalResult;
  }

  /**
   * Determina si usar chunking o consolidado basado en el documento y complejidad
   */
  private shouldUseChunkingStrategy(documentName: string, fieldCount: number): boolean {
    const docType = documentName.toUpperCase().replace('.pdf', '');
    
    // CRITICAL FIX: Force ALL documents to use CONSOLIDATED strategy
    // This matches the working pattern of WEATHER.pdf (46;74) 
    // The consolidated prompts from the database are designed to work as single API calls
    
    this.logger.log(`🎯 Strategy decision for ${docType}: forcing CONSOLIDATED (fields: ${fieldCount})`);
    return false; // Always use consolidated strategy - let the database prompts do the work
    
    // OLD LOGIC - was causing chunking to lose specific database prompts:
    // if (complexDocuments.includes(docType) && fieldCount > 5) {
    //   return true; // This was the problem - chunking lost database prompts
    // }
  }

  /**
   * Procesa documentos complejos dividiéndolos en chunks lógicos
   */
  private async processWithChunking(
    recordId: string,
    documentName: string,
    documentPrompt: ConsolidatedPrompt,
    pdfContent: string,
    variables: Record<string, string>,
    isExtremeLargeFile: boolean
  ): Promise<any[]> {
    const results: any[] = [];
    const processStartTime = Date.now();
    
    try {
      // Crear chunks lógicos de campos
      // FIXED: Pass the original consolidated prompt to use real prompts from database
      const chunks = this.createLogicalChunks(documentName, documentPrompt.fieldNames, documentPrompt.question);
      this.logger.log(`🧩 Created ${chunks.length} logical chunks for ${documentName}`);
      
      // Preparar documento una vez
      const documentNeeds = { needsVisual: true, needsText: true };
      const truncationLimit = documentName.toUpperCase().includes('LOP') || 
                              documentName.toUpperCase().includes('ROOF') ? 100 : 50;
      
      const preparedDocument = isExtremeLargeFile 
        ? await this.prepareDocumentWithTruncation(pdfContent, documentNeeds, truncationLimit)
        : await this.prepareDocument(pdfContent, documentNeeds, documentName);
      
      // Procesar cada chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        this.logger.log(`🔍 Processing chunk ${i + 1}/${chunks.length}: ${chunk.description} (${chunk.fields.length} fields)`);
        
        const chunkResults = await this.processChunk(
          recordId,
          documentName,
          chunk,
          preparedDocument,
          variables,
          processStartTime
        );
        
        results.push(...chunkResults);
      }
      
      return results;
      
    } catch (error) {
      this.logger.error(`Error in chunking strategy for ${documentName}: ${error.message}`);
      // Fallback consolidado a NOT_FOUND para todos los campos
      const notFoundAnswers = Array(documentPrompt.fieldNames.length).fill('NOT_FOUND').join(';');
      return [{
        pmc_field: documentPrompt.pmcField,
        question: documentPrompt.question,
        answer: notFoundAnswers,
        confidence: 0,
        processing_time_ms: Date.now() - processStartTime,
        error: error.message
      }];
    }
  }

  /**
   * Crea chunks lógicos basados en el tipo de documento
   */
  private createLogicalChunks(documentName: string, fieldNames: string[], questionPrompt?: string): Array<{description: string, fields: string[], prompt: string}> {
    const docType = documentName.toUpperCase().replace('.pdf', '');
    
    if (docType === 'LOP') {
      return [
        {
          description: 'Signatures and dates',
          fields: fieldNames.filter(f => f.includes('lop_date') || f.includes('signed') || f.includes('mechanics_lien')),
          // FIXED: Use the ACTUAL consolidated prompt from database for better accuracy
          // The consolidated prompt contains the specific instructions for each field
          prompt: questionPrompt && questionPrompt.length > 100 ? 
                  questionPrompt.substring(0, 800) : // Use first part of question prompt
                  'Find signature dates in this Letter of Protection document. Look specifically for: 1) Handwritten dates next to signature lines, 2) Dates in MM-DD-YY format near signatures, 3) Any date when this document was signed by the homeowner or patient. Return dates in MM-DD-YY format. For lien information, look for any text about mechanics liens, liens, or lien waivers.'
        },
        {
          description: 'Address information',
          fields: fieldNames.filter(f => f.includes('onb_street') || f.includes('onb_zip') || f.includes('onb_city') || f.includes('state')),
          prompt: 'Extract complete address details from this Letter of Protection. Find: 1) Full street address including house number and street name, 2) City name, 3) State abbreviation (like TX, CA, etc.), 4) ZIP code (5 digits). Look in patient/homeowner information sections, billing addresses, or contact information areas.'
        },
        {
          description: 'Policy and claim data',
          fields: fieldNames.filter(f => f.includes('policy_number') || f.includes('claim_number') || f.includes('date_of_loss')),
          prompt: 'Locate insurance-related information in this Letter of Protection: 1) Policy numbers (alphanumeric codes like ABC123456), 2) Claim numbers (reference numbers for insurance claims), 3) Date of loss (when the incident/damage occurred) in MM-DD-YY format. Look for sections mentioning insurance, coverage, or claim details.'
        },
        {
          description: 'Comparison validations',
          fields: fieldNames.filter(f => f.includes('_match')),
          prompt: 'Compare the extracted information with the reference data provided and validate matches for addresses, dates, policy numbers, and claim numbers.'
        }
      ].filter(chunk => chunk.fields.length > 0);
    }
    
    if (docType === 'POLICY') {
      return [
        {
          description: 'Policy dates and coverage period',
          fields: fieldNames.filter(f => f.includes('valid_from') || f.includes('valid_to') || f.includes('coverage_check')),
          prompt: 'Find policy dates in this insurance document: 1) Policy effective date (valid_from) in MM-DD-YY format, 2) Policy expiration date (valid_to) in MM-DD-YY format, 3) Verify if coverage is active for the specified date of loss. Look for "Policy Period", "Coverage Period", or "Effective Date" sections.'
        },
        {
          description: 'Insured information and company matching',
          fields: fieldNames.filter(f => f.includes('matching_insured') || f.includes('matching_company')),
          prompt: 'Extract names from this insurance policy: 1) Find the insured person/entity name (policy holder), 2) Find the insurance company name (carrier/issuer), 3) Compare these names with provided reference information and indicate YES/NO matches. Look in policy declarations, headers, or named insured sections.'
        },
        {
          description: 'Coverage and exclusions analysis',
          fields: fieldNames.filter(f => f.includes('covers_type_job') || f.includes('exclusion') || f.includes('covers_dol') || f.includes('wind')),
          prompt: 'Analyze policy coverage and exclusions: 1) Check if the policy covers the specific type of job/work being performed, 2) Look for wind-related exclusions or limitations, 3) Verify if coverage applies to the date of loss, 4) Return YES/NO for coverage questions. Look in coverage sections, exclusions, and policy conditions.'
        }
      ].filter(chunk => chunk.fields.length > 0);
    }
    
    // Default chunking para otros documentos
    const chunkSize = 4;
    const chunks = [];
    for (let i = 0; i < fieldNames.length; i += chunkSize) {
      chunks.push({
        description: `Fields ${i + 1}-${Math.min(i + chunkSize, fieldNames.length)}`,
        fields: fieldNames.slice(i, i + chunkSize),
        prompt: `Extract the following information from this ${documentName} document.`
      });
    }
    
    return chunks;
  }

  /**
   * Procesa un chunk específico de campos
   */
  private async processChunk(
    recordId: string,
    documentName: string,
    chunk: {description: string, fields: string[], prompt: string},
    preparedDocument: any,
    variables: Record<string, string>,
    processStartTime: number
  ): Promise<any[]> {
    try {
      // Reemplazar variables en el prompt del chunk
      let processedPrompt = chunk.prompt;
      Object.entries(variables).forEach(([key, value]) => {
        const placeholder = `%${key}%`;
        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        processedPrompt = processedPrompt.replace(new RegExp(escapedPlaceholder, 'g'), value);
      });

      // FIXED: Build a meaningful prompt that combines chunk instructions with field requirements
      const fullPrompt = `${processedPrompt}\n\nSpecifically extract:\n${chunk.fields.map(field => `- ${field}`).join('\n')}\n\nReturn exactly ${chunk.fields.length} values separated by semicolons in the order listed above. Use NOT_FOUND for any field where information cannot be found.`;

      // Calcular tamaño del archivo para estrategia
      const fileSizeEstimate = 1; // Simplificado para chunks

      // Determinar estrategia de procesamiento
      const strategy = await this.adaptiveStrategy.determineStrategy(
        'chunk_prompt',
        fullPrompt,
        ResponseType.TEXT,
        preparedDocument.images && preparedDocument.images.size > 0
      );

      // FORZAR análisis visual solo para documentos que realmente lo necesitan
      // TEMP FIX: Removiendo LOP, CERTIFICATE y POLICY para usar análisis de texto
      const forceVisualDocuments = ['ROOF'];
      const shouldForceVisual = forceVisualDocuments.some(doc => 
        documentName.toUpperCase().includes(doc)
      );

      let useVisualAnalysis = strategy.useVisualAnalysis || shouldForceVisual;

      this.logger.log(`🎯 Chunk strategy for ${chunk.description}: Visual=${useVisualAnalysis}`);

      let aiResponse: any;
      if (useVisualAnalysis && preparedDocument.images && preparedDocument.images.size > 0) {
        // Usar análisis visual para el chunk
        this.logger.log(`🔍 Using VISUAL ANALYSIS for chunk: ${chunk.description}`);
        
        const analysisResult = await this.largePdfVision.processLargePdfWithVision(
          [{
            pmc_field: `chunk_${chunk.description}`,
            question: fullPrompt,
            expected_type: ResponseType.TEXT
          }],
          Array.from(preparedDocument.images.values()).map(img => Buffer.from(img as string, 'base64')),
          preparedDocument.text || '',
          fileSizeEstimate
        );
        
        if (analysisResult && analysisResult.length > 0 && analysisResult[0]?.answer) {
          aiResponse = { response: analysisResult[0].answer };
          this.logger.log(`✅ Visual chunk analysis: "${analysisResult[0].answer.substring(0, 100)}..."`);
        } else {
          this.logger.warn(`⚠️ No response from visual analysis for chunk: ${chunk.description}`);
          aiResponse = { response: chunk.fields.map(() => 'NOT_FOUND').join(';') };
        }
      } else {
        // Usar análisis de texto para el chunk
        this.logger.log(`📝 Using TEXT ANALYSIS for chunk: ${chunk.description}`);
        
        const textPrompt = `${fullPrompt}\n\nDocument content:\n${preparedDocument.text || 'No text extracted'}`;
        const openAiResult = await this.openAiService.evaluateWithValidation(
          preparedDocument.text || '',
          fullPrompt,
          ResponseType.TEXT,
          undefined,
          `chunk_${chunk.description}`
        );
        aiResponse = { response: openAiResult.response };
      }

      // Parsear respuesta del chunk
      const responseText = aiResponse.response || '';
      const fieldValues = this.parseConsolidatedResponse(responseText, chunk.fields);
      
      this.logger.log(`📋 Chunk results for ${chunk.description}: ${fieldValues.filter(v => v !== 'NOT_FOUND').length}/${chunk.fields.length} found`);

      // Crear resultados para cada campo del chunk
      const processingTime = Date.now() - processStartTime;
      const chunkResults = [];
      
      for (let i = 0; i < chunk.fields.length; i++) {
        const fieldName = chunk.fields[i];
        const fieldValue = fieldValues[i] || 'NOT_FOUND';
        
        chunkResults.push({
          pmc_field: fieldName,
          question: chunk.prompt,
          answer: fieldValue,
          confidence: fieldValue === 'NOT_FOUND' ? 0 : 0.8,
          processing_time_ms: processingTime,
          error: null
        });

        // Guardar evaluación en BD - DESHABILITADO temporalmente por incompatibilidad de FK
        /*
        try {
          await this.claimEvaluationRepository.save({
            claimReference: recordId,
            documentName: documentName,
            promptId: null,
            question: `Chunking field: ${fieldName}`,
            response: fieldValue,
            confidence: fieldValue === 'NOT_FOUND' ? 0 : 0.8,
            processingTimeMs: processingTime,
            errorMessage: null
          });
        } catch (saveError) {
          this.logger.error(`Failed to save evaluation for ${fieldName}: ${saveError.message}`);
        }
        */
      }

      return chunkResults;

    } catch (error) {
      this.logger.error(`Error processing chunk ${chunk.description}: ${error.message}`);
      
      // Devolver errores para todos los campos del chunk
      const processingTime = Date.now() - processStartTime;
      return chunk.fields.map(fieldName => ({
        pmc_field: fieldName,
        question: chunk.prompt,
        answer: 'NOT_FOUND',
        confidence: 0,
        processing_time_ms: processingTime,
        error: error.message
      }));
    }
  }

  // Stub methods for controller compatibility
  async getDocumentPrompts(documentName?: string) {
    this.logger.warn('getDocumentPrompts called but not implemented for consolidated version');
    return [];
  }

  async getClaimHistory(claimReference: string) {
    this.logger.warn('getClaimHistory called but not implemented for consolidated version');
    return [];
  }

  async evaluateClaimBatch(dto: EvaluateClaimRequestDto, documents: any[]): Promise<EvaluateClaimResponseDto> {
    this.logger.warn('evaluateClaimBatch called but not implemented for consolidated version');
    // For now, just process the first document
    if (documents && documents.length > 0) {
      const firstDoc = documents[0];
      const modifiedDto = {
        ...dto,
        document_name: firstDoc.document_name,
        file_data: firstDoc.file_data
      };
      return this.evaluateClaim(modifiedDto);
    }
    
    return {
      record_id: dto.record_id,
      status: 'error' as const,
      results: {},
      summary: {
        total_documents: 0,
        processed_documents: 0,
        total_fields: 0,
        answered_fields: 0,
      },
      errors: ['No documents provided'],
      processed_at: new Date(),
    };
  }

  /**
   * Prepara un documento PDF para análisis extrayendo texto e imágenes
   */
  private async prepareDocument(
    pdfContent: string | null,
    documentNeeds: { needsVisual: boolean; needsText: boolean },
    documentName: string
  ): Promise<{ text: string | null; images: Map<number, string> | null }> {
    if (!pdfContent) {
      return { text: null, images: null };
    }

    const result = { text: null as string | null, images: null as Map<number, string> | null };

    try {
      // Extraer texto si se necesita
      if (documentNeeds.needsText) {
        const buffer = Buffer.from(pdfContent, 'base64');
        result.text = await this.pdfParserService.extractText(buffer);
        this.logger.log(`📄 Text extracted: ${result.text?.length || 0} characters`);
      }

      // Extraer imágenes si se necesita
      if (documentNeeds.needsVisual) {
        try {
          // Convertir páginas a imágenes (máximo 10 páginas para documentos normales)
          const pagesToConvert = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
          result.images = await this.pdfImageService.convertPages(pdfContent, pagesToConvert, { 
            documentName: documentName 
          });
          this.logger.log(`🖼️ Images extracted: ${result.images?.size || 0} pages`);
        } catch (imageError) {
          this.logger.warn(`⚠️ Image extraction failed: ${imageError.message}`);
          result.images = new Map();
        }
      }

      return result;
    } catch (error) {
      this.logger.error(`❌ Error preparing document: ${error.message}`);
      return { text: null, images: null };
    }
  }

  /**
   * Prepara un documento PDF con truncación para archivos extremadamente grandes
   */
  private async prepareDocumentWithTruncation(
    pdfContent: string | null,
    documentNeeds: { needsVisual: boolean; needsText: boolean },
    truncationLimit: number
  ): Promise<{ text: string | null; images: Map<number, string> | null }> {
    if (!pdfContent) {
      return { text: null, images: null };
    }

    const result = { text: null as string | null, images: null as Map<number, string> | null };

    try {
      // Extraer texto truncado si se necesita
      if (documentNeeds.needsText) {
        const buffer = Buffer.from(pdfContent, 'base64');
        result.text = await this.pdfParserService.extractTextTruncated(buffer, {
          maxPages: truncationLimit,
          firstPercentage: 0.6,
          lastPercentage: 0.4
        });
        this.logger.log(`📄 Truncated text extracted: ${result.text?.length || 0} characters (max ${truncationLimit} pages)`);
      }

      // Extraer solo primeras páginas para análisis visual si se necesita
      if (documentNeeds.needsVisual) {
        try {
          // Para archivos extremos, solo convertir las primeras páginas
          const limitedPages = Array.from({length: Math.min(truncationLimit, 5)}, (_, i) => i + 1);
          result.images = await this.pdfImageService.convertPages(pdfContent, limitedPages);
          this.logger.log(`🖼️ Truncated images extracted: ${result.images?.size || 0} pages (max ${limitedPages.length})`);
        } catch (imageError) {
          this.logger.warn(`⚠️ Truncated image extraction failed: ${imageError.message}`);
          result.images = new Map();
        }
      }

      return result;
    } catch (error) {
      this.logger.error(`❌ Error preparing document with truncation: ${error.message}`);
      return { text: null, images: null };
    }
  }

  /**
   * Waits for a session to be ready for querying
   * @param sessionId The session ID to wait for
   * @param maxWaitTime Maximum time to wait in milliseconds (default: 5 minutes)
   * @param checkInterval Interval between checks in milliseconds (default: 2 seconds)
   */
  private async waitForSessionReady(sessionId: string, maxWaitTime: number = 300000, checkInterval: number = 2000): Promise<void> {
    const startTime = Date.now();
    this.logger.log(`[SESSION-WAIT] Starting to wait for session ${sessionId} to be ready...`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // RACE CONDITION FIX: Verificar que los chunks realmente existan antes de continuar
        this.logger.log(`[SESSION-WAIT] Checking if chunks are available for session ${sessionId}...`);
        const processedChunks = await this.enhancedPdfProcessorService.getProcessedChunks(sessionId);

        if (processedChunks && processedChunks.length > 0) {
          this.logger.log(`[SESSION-WAIT] ✅ Session ${sessionId} is ready with ${processedChunks.length} chunks`);
          return; // Session is ready with chunks
        }

        this.logger.log(`[SESSION-WAIT] ⏳ Session ${sessionId} not ready yet (${processedChunks?.length || 0} chunks), waiting ${checkInterval}ms...`);
        await this.sleep(checkInterval);

      } catch (error) {
        this.logger.error(`[SESSION-WAIT] Error checking session ${sessionId}: ${error.message}`);
        // Don't throw immediately, keep retrying unless it's a critical error
        if (error.message.includes('not found') || error.message.includes('does not exist')) {
          throw error; // Critical error, stop waiting
        }

        this.logger.warn(`[SESSION-WAIT] Retrying in ${checkInterval}ms...`);
        await this.sleep(checkInterval);
      }
    }

    throw new Error(`Timeout waiting for session ${sessionId} to be ready after ${maxWaitTime}ms`);
  }

  /**
   * Utility method to sleep for a specified amount of time
   * @param ms Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

}
