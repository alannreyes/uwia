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
import { PdfToolkitService } from './services/pdf-toolkit.service';
import { PdfImageServiceV2 } from './services/pdf-image-v2.service';
import { AdaptiveProcessingStrategyService } from './services/adaptive-processing-strategy.service';
import { ResponseType } from './entities/uw-evaluation.entity';
import { openaiConfig } from '../../config/openai.config';
import { IntelligentPageSelectorService } from './services/intelligent-page-selector.service';
import { LargePdfVisionService } from './services/large-pdf-vision.service';
import { largePdfConfig } from '../../config/large-pdf.config';
import { ProductionLogger } from '../../common/utils/production-logger';
import { EnhancedPdfProcessorService } from './chunking/services/enhanced-pdf-processor.service';
import { ModernRagService } from './services/modern-rag.service';
import { ModernRAGService } from './services/modern-rag-2025.service';
import { VectorStorageService } from './services/vector-storage.service';
import { SemanticChunkingService } from './services/semantic-chunking.service';
import { GeminiFileApiService } from './services/gemini-file-api.service';
import { PdfValidatorService } from './services/pdf-validator.service';
import { Express } from 'express';
import { ClaimEvaluationGemini } from './entities/claim-evaluation-gemini.entity';

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
  @InjectRepository(ClaimEvaluationGemini)
  private claimEvaluationGeminiRepository: Repository<ClaimEvaluationGemini>,
    private openAiService: OpenAiService,
    private pdfParserService: PdfParserService,
    private pdfFormExtractor: PdfFormExtractorService,
    private pdfHybridAnalyzer: PdfHybridAnalyzerService,
    private pdfStreamProcessor: PdfStreamProcessorService,
    private pdfToolkit: PdfToolkitService,           // NEW: Unified PDF toolkit
    private pdfImageServiceV2: PdfImageServiceV2,    // NEW: Enhanced image service
    private pdfImageService: PdfImageService,        // Keep for backward compatibility
    private adaptiveStrategy: AdaptiveProcessingStrategyService,
    private pageSelector: IntelligentPageSelectorService,
    private largePdfVision: LargePdfVisionService,
    private enhancedPdfProcessorService: EnhancedPdfProcessorService,
  private modernRagService: ModernRagService,
  private modernRAGService2025: ModernRAGService,  // NEW: Modern RAG 2025 with embeddings
  private vectorStorageService: VectorStorageService,
  private semanticChunkingService: SemanticChunkingService,
  private geminiFileApiService: GeminiFileApiService,
  private pdfValidator: PdfValidatorService,
  ) {}

  public getVariableMapping(dto: any, contextData: any): Record<string, string> {
    this.logger.log(`🔍 [VAR-DEBUG] Getting variable mapping...`);
    this.logger.log(`🔧 [DEPLOY-TEST] Clean logging active: file_data excluded from logs`);

    // Compact logging - only log if context is empty
    if (!contextData || Object.keys(contextData).length === 0) {
      this.logger.warn(`⚠️ [VAR-DEBUG] Empty context detected`);
    }

    const mapping = {
      '%insured_name%': contextData?.insured_name || dto.insured_name || '',
      '%insurance_company%': contextData?.insurance_company || dto.insurance_company || '',
      '%insured_address%': contextData?.insured_address || dto.insured_address || '',
      '%insured_street%': contextData?.insured_street || dto.insured_street || '',
      '%insured_city%': contextData?.insured_city || dto.insured_city || '',
      '%insured_zip%': contextData?.insured_zip || dto.insured_zip || '',
      '%date_of_loss%': contextData?.date_of_loss || dto.date_of_loss || '',
      '%policy_number%': contextData?.policy_number || dto.policy_number || '',
      '%claim_number%': contextData?.claim_number || dto.claim_number || '',
      '%type_of_job%': contextData?.type_of_job || dto.type_of_job || '',
      '%cause_of_loss%': contextData?.cause_of_loss || dto.cause_of_loss || '',
    };

    // Only log variables if debugging is needed
    const hasEmptyVars = Object.values(mapping).some(v => v === '');
    if (hasEmptyVars) {
      this.logger.warn(`⚠️ [VAR-DEBUG] Some variables are empty`);
    }
    return mapping;
  }

  private replaceVariablesInPrompt(prompt: string, variables: Record<string, string>): string {
    let replacedPrompt = prompt;
    let replacements = 0;
    for (const key in variables) {
      // Always replace occurrences, even if value is empty string, to avoid leaking placeholders
      const value = variables[key] ?? '';
      if (replacedPrompt.includes(key)) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        replacedPrompt = replacedPrompt.replace(new RegExp(escaped, 'g'), value);
        replacements++;
        if (value) {
          this.logger.log(`✅ [VAR-REPLACE] ${key} → "${value}"`);
        }
      }
    }

    if (replacements === 0) {
      this.logger.warn(`⚠️ [VAR-REPLACE] No variable replacements made`);
    }
    // Alert if any placeholders remain like %insured_name%
    try {
      const leftover = replacedPrompt.match(/%[a-z_]+%/gi) || [];
      const uniqueLeftover = Array.from(new Set(leftover));
      if (uniqueLeftover.length > 0) {
        this.logger.warn(`⚠️ [VAR-REPLACE] Unresolved placeholders detected: ${uniqueLeftover.join(', ')}`);
      }
    } catch {}
    return replacedPrompt;
  }

  // Construye una pregunta genérica para RAG-ONLY cuando no hay prompts consolidados
  private buildDefaultRagQuestion(docName: string, variables: Record<string, string>): string {
    const name = (docName || 'document').toUpperCase();
    const v = (k: string) => variables[k] || '';
    // Incluir solo variables con valor para no ensuciar el prompt
    const contextParts: string[] = [];
    if (v('%insured_name%')) contextParts.push(`Insured: ${v('%insured_name%')}`);
    if (v('%insurance_company%')) contextParts.push(`Insurer: ${v('%insurance_company%')}`);
    if (v('%insured_address%')) contextParts.push(`Address: ${v('%insured_address%')}`);
    if (v('%date_of_loss%')) contextParts.push(`Date of Loss: ${v('%date_of_loss%')}`);
    if (v('%policy_number%')) contextParts.push(`Policy #: ${v('%policy_number%')}`);
    if (v('%claim_number%')) contextParts.push(`Claim #: ${v('%claim_number%')}`);
    if (v('%type_of_job%')) contextParts.push(`Job Type: ${v('%type_of_job%')}`);
    if (v('%cause_of_loss%')) contextParts.push(`Cause of Loss: ${v('%cause_of_loss%')}`);

    const contextLine = contextParts.length ? `Context: ${contextParts.join(' | ')}` : '';

    return [
      `Analyze the ${name} document using only the RAG knowledge base.`,
      contextLine,
      `Provide a concise, factual summary of the key information present in the document that would be most useful for underwriting.`,
      `If specific fields are commonly extracted for this document type, identify them with their values when possible.`,
      `Answer in plain text; avoid JSON unless necessary.`
    ].filter(Boolean).join('\n');
  }

  /**
   * Extrae variables básicas del documento usando RAG cuando no están disponibles en body/context
   */
  private async extractBasicVariablesFromDocument(sessionId: string): Promise<Record<string, string>> {
    this.logger.log(`🔍 [VAR-EXTRACT] Extracting basic variables from document...`);

    try {
      // 🚀 IMPROVED: Better extraction prompt with more specific instructions
      const extractionPrompt = `
        Please extract the following information from this document and return it in JSON format:
        {
          "insured_name": "name of the insured person/company (look for policyholder, insured, client names)",
          "insurance_company": "name of the insurance company (look for carrier, insurer, company providing coverage)",
          "date_of_loss": "date when loss/damage occurred (MM-DD-YY format)",
          "policy_number": "insurance policy number (look for Policy #, Policy No, etc.)",
          "claim_number": "insurance claim number (look for Claim #, Claim No, etc.)",
          "insured_address": "full address of insured property",
          "insured_street": "street address only",
          "insured_city": "city name only", 
          "insured_zip": "ZIP code only",
          "type_of_job": "type of work/job being performed",
          "cause_of_loss": "cause of damage/loss (wind, hail, storm, etc.)"
        }
        
        For any field not found, use empty string "". 
        Extract from text even if formatting varies.
        Look carefully through ALL pages for this information.
        Return ONLY the JSON object, no additional text.
      `;

      const ragResult = await this.modernRagService.executeRAGPipeline(extractionPrompt, sessionId);

      // 🚀 IMPROVED: Better JSON parsing with fallback
      let extractedData: any = {};
      try {
        // Try to extract JSON from the response
        const jsonMatch = ragResult.answer.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extractedData = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback: try parsing the entire response
          extractedData = JSON.parse(ragResult.answer);
        }
      } catch (parseError) {
        this.logger.warn(`⚠️ [VAR-EXTRACT] Failed to parse JSON response: ${parseError.message}`);
      }

      // Convert to variable format with % symbols
      const variables: Record<string, string> = {};
      const fieldMapping = {
        'insured_name': '%insured_name%',
        'insurance_company': '%insurance_company%',
        'date_of_loss': '%date_of_loss%',
        'policy_number': '%policy_number%',
        'claim_number': '%claim_number%',
        'insured_address': '%insured_address%',
        'insured_street': '%insured_street%',
        'insured_city': '%insured_city%',
        'insured_zip': '%insured_zip%',
        'type_of_job': '%type_of_job%',
        'cause_of_loss': '%cause_of_loss%'
      };

      for (const [sourceField, targetField] of Object.entries(fieldMapping)) {
        variables[targetField] = extractedData[sourceField] || '';
      }

      this.logger.log(`✅ [VAR-EXTRACT] Extracted variables: ${JSON.stringify(variables, null, 2)}`);
      return variables;

    } catch (error) {
      this.logger.error(`❌ [VAR-EXTRACT] Failed to extract variables: ${error.message}`);
      // Return empty variables as fallback
      return {
        '%insured_name%': '',
        '%insurance_company%': '',
        '%insured_address%': '',
        '%insured_street%': '',
        '%insured_city%': '',
        '%insured_zip%': '',
        '%date_of_loss%': '',
        '%policy_number%': '',
        '%claim_number%': '',
        '%type_of_job%': '',
        '%cause_of_loss%': '',
      };
    }
  }

  async processLargeFileSynchronously(
    file: Express.Multer.File,
    body: any,
  ): Promise<EvaluateClaimResponseDto> {
    const { record_id, document_name } = body;
    let context = body.context;
    if (typeof context === 'string') {
      try {
        context = JSON.parse(context);
        this.logger.log(`🧩 [SYNC-LARGE] Parsed context JSON for variable mapping`);
      } catch (e) {
        this.logger.warn(`⚠️ [SYNC-LARGE] Failed to parse context JSON; using raw value`);
      }
    }

    // 🚨 CRITICAL DEBUG LOGGING
    this.logger.log(`🚨 [SYNC-LARGE-ENTRY] ========== PROCESSING LARGE FILE ==========`);
    this.logger.log(`🚨 [SYNC-LARGE-ENTRY] File: ${file.originalname}`);
    this.logger.log(`🚨 [SYNC-LARGE-ENTRY] Size: ${file.size} bytes (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    this.logger.log(`🚨 [SYNC-LARGE-ENTRY] Document: ${document_name}`);
    this.logger.log(`🚨 [SYNC-LARGE-ENTRY] Starting synchronous processing`);
    this.logger.log(`🚨 [SYNC-LARGE-ENTRY] ================================================`);

    try {
      // Validate and auto-repair PDF if needed
      const validation = await this.pdfValidator.validateAndRepairPdf(file.buffer, file.originalname);

      if (!validation.isValid) {
        this.logger.error(`[SYNC-LARGE] Invalid PDF: ${validation.error}`);
        throw new Error(validation.error || 'Invalid PDF format');
      }

      if (validation.wasRepaired) {
        this.logger.log(`🔧 [SYNC-LARGE] PDF auto-repaired: ${validation.details}`);
        this.logger.log(`📁 [SYNC-LARGE] Original size: ${(file.size / 1024 / 1024).toFixed(2)}MB -> Repaired: ${(validation.buffer.length / 1024 / 1024).toFixed(2)}MB`);
        file.buffer = validation.buffer; // Use repaired buffer
        file.size = validation.buffer.length; // Update size
      }

      // 1. Procesar y almacenar el archivo en la base de datos
      const session = await this.enhancedPdfProcessorService.processLargePdf({
        buffer: file.buffer,
        originalname: file.originalname,
        size: file.size
      });

      this.logger.log(`[SYNC-LARGE] File stored with session ID: ${session.id}`);

      // 🔍 DETECTION: Check if this is an image-based PDF that needs Gemini File API
      const fileSizeMB = file.size / (1024 * 1024);
      const shouldUseGeminiFileApi = await this.shouldUseGeminiFileApi(file.buffer, fileSizeMB);
      
      if (shouldUseGeminiFileApi && this.geminiFileApiService.isAvailable()) {
        this.logger.log(`🚀 [GEMINI-FILE-API] Detected image-based PDF - using Gemini File API for better OCR`);
        try {
          return await this.processWithGeminiFileApi(file, body, context);
        } catch (geminiError) {
          this.logger.warn(`⚠️ [GEMINI-FILE-API] Failed, falling back to standard processing: ${geminiError.message}`);
          // Continue with standard processing below
        }
      }

      // 2. Obtener el prompt para este documento
      const documentPrompts = await this.documentPromptRepository.find({
        where: { documentName: `${document_name}.pdf`, active: true },
        order: { promptOrder: 'ASC' },
      });

      let prompt: { pmcField: string; question: string };
      if (documentPrompts.length === 0) {
        this.logger.warn(`⚠️ [SYNC-LARGE] No active prompts found for document: ${document_name}.pdf — switching to RAG-ONLY fallback`);
        // Fallback: construir un prompt genérico para RAG-ONLY
        const defaultPmcField = `${String(document_name || 'document').toLowerCase()}_responses`;
        // Preparar mapping preliminar (puede rellenarse luego)
        const prelimVars = this.getVariableMapping(body, context);
        const defaultQuestion = this.buildDefaultRagQuestion(String(document_name || 'document'), prelimVars);
        prompt = { pmcField: defaultPmcField, question: defaultQuestion };
      } else {
        prompt = documentPrompts[0];
      }

      // Verificar si necesitamos extraer variables del documento (cuando body/context están vacíos)
  let variableMapping = this.getVariableMapping(body, context);
      const hasEmptyVariables = Object.values(variableMapping).some(value => value === '');

      if (hasEmptyVariables) {
        this.logger.log(`⚠️ [VAR-EXTRACT] Some variables are empty; attempting auto-extraction from document`);
        try {
          const extracted = await this.extractBasicVariablesFromDocument(session.id);
          // Merge: fill only missing keys
          for (const k of Object.keys(variableMapping)) {
            if (!variableMapping[k] && extracted[k]) {
              variableMapping[k] = extracted[k];
            }
          }
          this.logger.log(`✅ [VAR-EXTRACT] Filled missing variables from document where available`);
        } catch (exErr) {
          this.logger.warn(`⚠️ [VAR-EXTRACT] Auto-extraction failed: ${exErr.message}`);
        }
      }

  // Build question later as variables may be enriched after chunks are ready
  let question = this.replaceVariablesInPrompt(prompt.question, variableMapping);

      // 3. Esperar a que la sesión esté lista para consultas
      this.logger.log(`[SYNC-LARGE] Waiting for session ${session.id} to be ready...`);
      try {
        await this.waitForSessionReady(session.id);
      } catch (waitErr) {
        this.logger.error(`[SYNC-LARGE] Wait for session failed: ${waitErr.message}`);
        this.logger.warn(`[SYNC-LARGE] Falling back to DIRECT TEXT processing (no RAG chunks)`);

        // Fallback: extract text directly and answer without RAG
        let directText = '';
        try {
          const extraction = await this.pdfToolkit.extractText(file.buffer);
          directText = extraction.text || '';
          this.logger.log(`[SYNC-LARGE] Direct text extracted: ${directText.length} chars`);
        } catch (texErr) {
          this.logger.warn(`[SYNC-LARGE] Direct text extraction failed: ${texErr.message}`);
        }

        try {
          const textEval = await this.openAiService.evaluateWithValidation(
            directText,
            question,
            ResponseType.TEXT,
            undefined,
            prompt.pmcField
          );

          const pmcResult: PMCFieldResultDto = {
            pmc_field: prompt.pmcField,
            question: question,
            answer: textEval.response,
            confidence: textEval.final_confidence || textEval.confidence || 0.5,
            expected_type: 'text',
          };

          const results = { [`${document_name}.pdf`]: [pmcResult] };
          return {
            record_id: record_id,
            status: 'partial',
            results,
            summary: {
              total_documents: 1,
              processed_documents: 1,
              total_fields: 1,
              answered_fields: 1,
            },
            processed_at: new Date(),
          };
        } catch (fallbackErr) {
          this.logger.error(`[SYNC-LARGE] Fallback text evaluation failed: ${fallbackErr.message}`);
          throw new HttpException(
            `Failed to process large file synchronously (fallback also failed): ${fallbackErr.message}`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }
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

      // Optional: Re-extract variables now that chunks/embeddings are ready
      try {
        const stillEmpty = Object.values(variableMapping).some(v => v === '');
        if (stillEmpty) {
          this.logger.log(`🔁 [VAR-EXTRACT] Retrying variable extraction with ready chunks...`);
          const extracted2 = await this.extractBasicVariablesFromDocument(session.id);
          let filled = 0;
          for (const k of Object.keys(variableMapping)) {
            if (!variableMapping[k] && extracted2[k]) {
              variableMapping[k] = extracted2[k];
              filled++;
            }
          }
          if (filled > 0) {
            this.logger.log(`✅ [VAR-EXTRACT] Filled ${filled} variables after chunks ready`);
          } else {
            this.logger.warn(`⚠️ [VAR-EXTRACT] No additional variables found after retry`);
          }
          // Recompute question with enriched variables
          question = this.replaceVariablesInPrompt(prompt.question, variableMapping);
        }
      } catch (rexErr) {
        this.logger.warn(`⚠️ [VAR-EXTRACT] Retry extraction failed: ${rexErr.message}`);
      }

      // 4. Ejecutar la consulta RAG moderna y esperar la respuesta
      this.logger.log(`🚀 [RAG-INTEGRATION] Executing RAG pipeline...`);
      this.logger.log(`🔍 [VAR-DEBUG] Question: "${question.substring(0, 150)}..."`);

      const ragResult = await this.modernRagService.executeRAGPipeline(question, session.id);
  
  this.logger.log(`✅ [RAG-INTEGRATION] RAG pipeline completed successfully`);
  this.logger.log(`📊 [RAG-INTEGRATION] Answer received: ${ragResult.answer ? ragResult.answer.length + ' chars' : 'empty'}`);
  this.logger.log(`📚 [RAG-INTEGRATION] Sources used: ${ragResult.sources?.length || 0}`);

      // 4. Formatear la respuesta para que coincida con la estructura esperada
      const pmcResult: PMCFieldResultDto = {
        pmc_field: prompt.pmcField,
        question: question, // Usar la pregunta con variables sustituidas, no prompt.question
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
      const variables = (dto as any)._variables || this.getVariableMapping(dto, contextData);

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
      
      // Check if file exceeds extreme size limit
      if (fileSizeEstimate > EXTREME_FILE_LIMIT_MB) {
        isExtremeLargeFile = true;
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
      // Reemplazar variables dinámicas al inicio para tener siempre el prompt procesado
      let processedPrompt = this.replaceVariablesInPrompt(documentPrompt.question, variables);

      if (!pdfContent) {
        this.logger.warn(`No PDF content provided for ${documentName}`);
        const notFoundAnswers = Array(documentPrompt.fieldNames.length).fill('NOT_FOUND').join(';');
        return [{
          pmc_field: documentPrompt.pmcField,
          question: processedPrompt,
          answer: notFoundAnswers,
          confidence: 0,
          processing_time_ms: 0,
          error: 'No PDF content provided'
        }];
      }

      // Determinar estrategia de procesamiento según documento
      // Always use consolidated strategy - database-first approach
      this.logger.log(`📦 Using CONSOLIDATED strategy for ${documentName} (${documentPrompt.expectedFieldsCount} fields)`);

      // Preparar documento para análisis
      const documentNeeds = { needsVisual: true, needsText: true };
      
      // Standard truncation limit for extreme files
      const truncationLimit = 50;
      
      const preparedDocument = isExtremeLargeFile 
        ? await this.prepareDocumentWithTruncation(pdfContent, documentNeeds, truncationLimit)
        : await this.prepareDocument(pdfContent, documentNeeds, documentName);
      
      this.logger.log(`📑 Document preparation for ${documentName}: truncation=${isExtremeLargeFile}, limit=${truncationLimit}`);

      // processedPrompt ya está con variables reemplazadas; logs de reemplazo se manejan en helper

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

      // Use strategy from AdaptiveProcessingStrategy (database-agnostic)
      let useVisualAnalysis = strategy.useVisualAnalysis;

      // 🚀 FORCE VISION MODE when text extraction is insufficient
      if (!useVisualAnalysis && preparedDocument.text && preparedDocument.images && preparedDocument.images.size > 0) {
        const textLength = preparedDocument.text.length;
        const numPages = preparedDocument.images.size;
        const textPerPage = textLength / numPages;
        const textPerMB = textLength / Math.max(fileSizeEstimate, 0.1);
        
        // Force vision if:
        // 1. Very little text overall (< 1000 chars)
        // 2. Very little text per page (< 200 chars/page)
        // 3. Low text density per MB (< 50,000 chars/MB indicates scanned/image-heavy PDF)
        const shouldForceVision = textLength < 1000 || 
                                 textPerPage < 200 || 
                                 textPerMB < 50000;
        
        if (shouldForceVision) {
          useVisualAnalysis = true;
          this.logger.log(`🔴 FORCING VISION MODE due to insufficient text extraction:`);
          this.logger.log(`   - Total text: ${textLength} chars`);
          this.logger.log(`   - Text per page: ${textPerPage.toFixed(1)} chars/page`);
          this.logger.log(`   - Text density: ${textPerMB.toFixed(0)} chars/MB`);
          this.logger.log(`   - Original strategy: ${strategy.useVisualAnalysis} -> FORCED: true`);
        }
      }

      // LOGGING: Decisión de estrategia
      this.logger.log(`🎯 Strategy decision for ${documentName}:`);
      this.logger.log(`   - Strategy: Visual=${strategy.useVisualAnalysis}, Model=${strategy.primaryModel}`);
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

      // Use responses directly - they are already in correct semicolon-separated format
      const visionArr = visionAnswer ? visionAnswer.split(';') : null;
      const textArr = textAnswer ? textAnswer.split(';') : null;

      this.logger.log(`🔍 [FUSION-DEBUG] Input arrays:`);
      this.logger.log(`   - Vision array: ${visionArr ? visionArr.length : 0} items`);
      this.logger.log(`   - Text array: ${textArr ? textArr.length : 0} items`);
      this.logger.log(`   - Expected fields: ${documentPrompt.fieldNames.length}`);
      if (visionArr) this.logger.log(`   - Vision raw: "${visionAnswer}"`);
      if (textArr) this.logger.log(`   - Text raw: "${textAnswer}"`);

      // Simple fusion: prefer non-NOT_FOUND answers, prefer longer answers for data fields
      const combinedValues: string[] = [];
      for (let i = 0; i < documentPrompt.fieldNames.length; i++) {
        const v = visionArr ? (visionArr[i] || 'NOT_FOUND') : 'NOT_FOUND';
        const t = textArr ? (textArr[i] || 'NOT_FOUND') : 'NOT_FOUND';
        const fieldName = documentPrompt.fieldNames[i];

        let chosen = 'NOT_FOUND';

        // Only debug critical fields if there's a conflict
        const isCriticalField = fieldName.includes('claim_number') || fieldName.includes('policy_number');
        const hasConflict = v !== t && v !== 'NOT_FOUND' && t !== 'NOT_FOUND';

        // Simple fusion logic without hardcoded field knowledge
        if (t !== 'NOT_FOUND' && v === 'NOT_FOUND') chosen = t;
        else if (v !== 'NOT_FOUND' && t === 'NOT_FOUND') chosen = v;
        else if (t !== 'NOT_FOUND' && v !== 'NOT_FOUND') {
          // For boolean-like answers, prefer YES over NO
          if ((t === 'YES' || v === 'YES') && (t === 'NO' || v === 'NO')) {
            chosen = 'YES';
          } else {
            // Prefer longer, more informative answer
            chosen = (v.length > t.length) ? v : t;
          }
        } else {
          chosen = 'NOT_FOUND';
        }

        // Log only important fusion decisions
        if (isCriticalField && hasConflict) {
          this.logger.log(`🔍 [FUSION] ${fieldName}: Vision="${v}" Text="${t}" → "${chosen}"`);
        }

        combinedValues.push((chosen || '').toString().trim());
      }

      const responseText = combinedValues.join(';');

      // LOGGING: Combined result BEFORE any additional parsing
      this.logger.log(`🎯 [FINAL-FIX] Combined result for ${documentName}:`);
      this.logger.log(`   - Response length: ${responseText ? responseText.length : 0} chars`);
      this.logger.log(`   - Full response: "${responseText}"`);
      this.logger.log(`   - Split count: ${responseText.split(';').length}`);
      
      // Para respuestas consolidadas, la respuesta ya debería venir en formato correcto
      let finalAnswer: string;
      let finalConfidence: number;
      let actualProcessingTime: number;
      
      // Use the already correctly formatted responseText from combined values
      // No need to re-parse as combinedValues was already processed correctly above
      finalAnswer = responseText;
      const fieldValues = responseText.split(';');
      this.logger.log(`📋 Using combined values for ${documentName}:`);
      this.logger.log(`   - Expected fields: ${documentPrompt.fieldNames.length}`);
      this.logger.log(`   - Final values: ${fieldValues.length}`);
      this.logger.log(`   - Values with content: ${fieldValues.filter(v => v && v !== 'NOT_FOUND').length}`);
      const foundFields = fieldValues.filter(value => value !== 'NOT_FOUND').length;
      // Confianza: combinar aportes de texto y visión si existen; si no, proporción encontrada
      const baseConf = Math.max(textConf, visionConf);
      finalConfidence = baseConf > 0 ? baseConf : (foundFields / Math.max(1, fieldValues.length));
      actualProcessingTime = Math.max(visionTime, Date.now() - processStartTime);

      // REMOVED: All hardcoded post-processing logic
      // The database prompts are the single source of truth
      // If AI responses are incorrect, the prompts should be improved, not overridden with code

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
      this.logger.log(`🎯 [FINAL-FIX] COMPLETE FINAL ANSWER: "${finalAnswer}"`);
      this.logger.log(`   - Matches combined result: ${finalAnswer === responseText ? 'YES' : 'NO'}`);
      
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

  // REMOVED: detectMechanicsLien() and recalculateMatches() functions
  // These contained hardcoded business logic that should be in database prompts instead
  // The AI responses should be trusted as-is from the database-driven prompts


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
   * Determina si usar chunking o consolidado - ALWAYS use consolidated strategy
   * The database prompts are designed as single consolidated queries
   */
  private shouldUseChunkingStrategy(documentName: string, fieldCount: number): boolean {
    // ALWAYS use consolidated strategy - database prompts are the source of truth
    this.logger.log(`🎯 Strategy decision: CONSOLIDATED (fields: ${fieldCount}) - database prompts control processing`);
    return false; // Always use consolidated strategy - let the database prompts do the work
  }

  // REMOVED: processWithChunking() - chunking strategy is never used
  // The system always uses consolidated prompts from the database

  // REMOVED: createLogicalChunks() and processChunk() functions
  // These contained hardcoded document-specific logic that should be in database prompts instead
  // The system now uses only consolidated prompts from the database

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
      const buffer = Buffer.from(pdfContent, 'base64');

      // Usar nuevo PdfToolkit para extracción de texto
      if (documentNeeds.needsText) {
        const extraction = await this.pdfToolkit.extractText(buffer);
        result.text = extraction.text;
        this.logger.log(`📄 Text extracted: ${result.text?.length || 0} characters`);

        // Log adicional si detecta firmas
        if (extraction.hasSignatures) {
          this.logger.log(`✍️ Signature fields detected in ${documentName}`);
        }
      }

      // Usar nuevo PdfImageServiceV2 para imágenes
      if (documentNeeds.needsVisual) {
        try {
          const pagesToConvert = [1, 2, 3, 4, 5];
          result.images = await this.pdfImageServiceV2.convertPages(
            pdfContent,
            pagesToConvert,
            { documentName }
          );
          this.logger.log(`🖼️ Images extracted: ${result.images?.size || 0} pages`);
        } catch (imageError) {
          this.logger.warn(`⚠️ Image extraction failed: ${imageError.message}`);
          // No throw - continuar con solo texto
          result.images = new Map();
        }
      }

      return result;
    } catch (error) {
      this.logger.error(`❌ Error preparing document: ${error.message}`);
      // Retornar parcial si es posible
      return result;
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
        // Usar extractTextByPages y truncar manualmente si es necesario
        const pages = await this.pdfParserService.extractTextByPages(buffer);
        const limitedPages = pages.slice(0, truncationLimit);
        result.text = limitedPages.map(p => p.content).join('\n');
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
  private async waitForSessionReady(sessionId: string, maxWaitTime: number = Number(process.env.RAG_WAIT_TIMEOUT_MS || 180000), checkInterval: number = Number(process.env.RAG_WAIT_INTERVAL_MS || 2000)): Promise<void> {
    const startTime = Date.now();
    this.logger.log(`[SESSION-WAIT] Starting to wait for session ${sessionId} to be ready...`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // RACE CONDITION FIX: Verificar que los chunks realmente existan antes de continuar
        this.logger.log(`[SESSION-WAIT] Checking if chunks are available for session ${sessionId}...`);
        const processedChunks = await this.enhancedPdfProcessorService.getProcessedChunks(sessionId);
        // Consultar el estado de la sesión para detectar casos "ready" sin chunks
        const sessionMeta = await (this.enhancedPdfProcessorService as any).chunkStorageService?.getSession(sessionId).catch?.(() => null) || null;

        if (processedChunks && processedChunks.length > 0) {
          this.logger.log(`[SESSION-WAIT] ✅ Session ${sessionId} is ready with ${processedChunks.length} chunks`);
          return; // Session is ready with chunks
        }

        // Si la sesión está marcada como ready pero no hay chunks, salir temprano para forzar fallback
        if (sessionMeta && sessionMeta.status === 'ready' && (!processedChunks || processedChunks.length === 0)) {
          this.logger.warn(`[SESSION-WAIT] ⚠️ Session ${sessionId} is READY but has 0 chunks. Triggering direct-text fallback.`);
          throw new Error('READY_WITHOUT_CHUNKS');
        }

  this.logger.log(`[SESSION-WAIT] ⏳ Session ${sessionId} not ready yet (${processedChunks?.length || 0} chunks), waiting ${checkInterval}ms... (elapsed: ${Math.floor((Date.now()-startTime)/1000)}s)`);
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
  }

  /**
   * Detecta si un PDF debe usar Gemini File API (imagen-based, poco texto extraído)
   * Mejorado para detectar PDFs completamente escaneados como POLICY64.pdf
   */
  private async shouldUseGeminiFileApi(buffer: Buffer, fileSizeMB: number): Promise<boolean> {
    try {
      // Quick text extraction to check if it's image-based
      const quickExtraction = await this.pdfParserService.extractText(buffer);
      const textLength = quickExtraction.length;
      const charsPerMB = textLength / fileSizeMB;
      
      // Análisis adicional para PDFs escaneados
      const content = buffer.toString('latin1');
      const hasImages = content.includes('/XObject') || content.includes('/Image');
      const hasText = content.includes('/Font') || content.includes('/Text');
      const fontMatches = content.match(/\/Type\s*\/Font/g) || [];
      const imageMatches = content.match(/\/Type\s*\/XObject[\s\S]*?\/Subtype\s*\/Image/g) || [];
      const pageMatches = content.match(/\/Type\s*\/Page[^s]/g) || [];
      
      const fontCount = fontMatches.length;
      const imageCount = imageMatches.length;
      const pageCount = pageMatches.length || 1;
      const fontDensity = fontCount / pageCount;
      
      // Criterios mejorados para usar Gemini File API:
      // 1. Archivo con muy poco texto extraído (< 100 chars/MB)
      // 2. O archivo con densidad de fuentes muy baja (< 0.5 fuentes por página)
      // 3. O archivo donde hay más imágenes que fuentes (ratio > 2:1)
      // 4. O archivos grandes (> 50MB) con poco texto
      const isScanned = (
        charsPerMB < 100 ||                           // Muy poco texto extraído
        fontDensity < 0.5 ||                          // Pocas fuentes por página
        (imageCount > fontCount * 2) ||               // Más imágenes que fuentes
        (fileSizeMB > 50 && charsPerMB < 500) ||      // Archivos grandes con poco texto
        textLength < 200                              // Muy poco texto total
      );
      
      this.logger.log(`📊 [DETECTION] PDF Analysis: ${fileSizeMB.toFixed(2)}MB, ${textLength} chars, ${charsPerMB.toFixed(1)} chars/MB`);
      this.logger.log(`� [DETECTION] Pages: ${pageCount}, Fonts: ${fontCount}, Images: ${imageCount}`);
      this.logger.log(`📈 [DETECTION] Font density: ${fontDensity.toFixed(2)} fonts/page`);
      this.logger.log(`🔍 [DETECTION] Scanned PDF detected: ${isScanned ? 'YES' : 'NO'} → ${isScanned ? 'GEMINI FILE API' : 'MODERN RAG'}`);
      
      return isScanned;
    } catch (error) {
      this.logger.warn(`⚠️ [DETECTION] Could not analyze PDF, defaulting to standard processing: ${error.message}`);
      return false;
    }
  }

  /**
   * Procesa un archivo usando Gemini File API
   */
  private async processWithGeminiFileApi(
    file: Express.Multer.File,
    body: any,
    context: any
  ): Promise<EvaluateClaimResponseDto> {
    this.logger.log(`🚀 [GEMINI-FILE-API] Starting processing for ${file.originalname}`);
    
    // Obtener variable mapping
    const variableMapping = this.getVariableMapping(body, context);
    
    // Obtener el prompt para este documento
    const { document_name } = body;
    const documentPrompts = await this.documentPromptRepository.find({
      where: { documentName: `${document_name}.pdf`, active: true },
      order: { promptOrder: 'ASC' },
    });

    if (documentPrompts.length === 0) {
      throw new Error(`No active prompts found for document: ${document_name}.pdf`);
    }

    const prompt = documentPrompts[0];
    const question = this.replaceVariablesInPrompt(prompt.question, variableMapping);
    
    // Procesar con Gemini File API
    const result = await this.geminiFileApiService.processPdfDocument(
      file.buffer,
      question,
      ResponseType.TEXT
    );
    
    this.logger.log(`✅ [GEMINI-FILE-API] Processing completed in ${result.processingTime}ms using ${result.method}`);
    
    // Construir respuesta en formato estándar
    const pmcFieldResult: PMCFieldResultDto = {
      pmc_field: prompt.pmcField,
      question: question,
      answer: result.response,
      confidence: result.confidence,
      expected_type: 'text',
      processing_time: result.processingTime
    };
    
    const response: EvaluateClaimResponseDto = {
      record_id: body.record_id || 'gemini-file-api',
      status: 'success',
      results: {
        [`${document_name}.pdf`]: [pmcFieldResult]
      },
      summary: {
        total_documents: 1,
        processed_documents: 1,
        total_fields: 1,
        answered_fields: 1
      },
      processed_at: new Date()
    };

    // Guardar evaluación en tabla separada para Gemini y limpiar RAG
    try {
      const promptConsolidadoId = prompt.id;
      const evaluation = this.claimEvaluationGeminiRepository.create({
        claimReference: body.claim_number || 'unknown',
        documentName: `${document_name}.pdf`,
        promptConsolidadoId,
        question: question,
        response: result.response,
        confidence: result.confidence,
        processingTimeMs: result.processingTime
      });
      await this.claimEvaluationGeminiRepository.save(evaluation);
      this.logger.log(`💾 [GEMINI-FILE-API] Evaluation saved to claim_evaluations_gemini (prompt_consolidado_id=${promptConsolidadoId})`);
    } catch (dbError) {
      this.logger.warn(`⚠️ [GEMINI-FILE-API] Could not save to database: ${dbError.message}`);
    }

    return response;
  }

  /**
   * Utility method to sleep for a specified amount of time
   * @param ms Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
