import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from './openai.service';
import { GeminiService } from './gemini.service';
import { IntelligentPageSelectorService, FieldPageMapping } from './intelligent-page-selector.service';
import { largePdfConfig } from '../../../config/large-pdf.config';
import { ResponseType } from '../entities/uw-evaluation.entity';
import { ProductionLogger } from '../../../common/utils/production-logger';

export interface LargePdfProcessingResult {
  pmc_field: string;
  answer: string;
  confidence: number;
  processing_time_ms: number;
  pages_analyzed: number[];
  strategy_used: 'targeted-vision' | 'multi-page-analysis' | 'comprehensive-scan';
  reasoning?: string;
}

export interface ProcessingStrategy {
  useTargetedPages: boolean;
  maxPagesPerField: number;
  enableEarlyExit: boolean;
  useGeminiPrimary: boolean;
  allowPartialAnalysis: boolean;
}

@Injectable()
export class LargePdfVisionService {
  private readonly logger = new Logger(LargePdfVisionService.name);
  private readonly prodLogger = new ProductionLogger(LargePdfVisionService.name);

  constructor(
    private readonly openaiService: OpenAiService,
    private readonly geminiService: GeminiService,
    private readonly pageSelector: IntelligentPageSelectorService,
  ) {}

  /**
   * Procesa PDF grande usando vision targeting inteligente
   */
  async processLargePdfWithVision(
    prompts: Array<{pmc_field: string, question: string, expected_type: ResponseType}>,
    images: Buffer[],
    extractedText: string,
    fileSizeMB: number
  ): Promise<LargePdfProcessingResult[]> {

    this.prodLogger.strategyDebug('large_pdf', 'processing_start', `${fileSizeMB.toFixed(2)}MB, ${images.length} pages, ${prompts.length} fields`);

    const startTime = Date.now();
    const results: LargePdfProcessingResult[] = [];
    
    // PASO 2: Determinar estrategia de procesamiento (movido fuera del try para que esté disponible en catch)
    const strategy = this.determineProcessingStrategy(fileSizeMB, images.length, extractedText.length);

    try {
      // PASO 1: Análisis inteligente de páginas
      const fieldPageMappings = await this.pageSelector.identifyRelevantPagesForFields(
        images, 
        prompts
      );
      
      this.prodLogger.strategyDebug('large_pdf', 'strategy', `targeted=${strategy.useTargetedPages}, maxPages=${strategy.maxPagesPerField}, geminiPrimary=${strategy.useGeminiPrimary}`);

      // PASO 3: Procesar campos en grupos optimizados
      const fieldGroups = this.groupFieldsByComplexity(prompts, fieldPageMappings);
      
      // Procesar grupos secuencialmente para control de recursos
      for (const [groupName, groupFields] of Object.entries(fieldGroups)) {
        this.prodLogger.strategyDebug('large_pdf', groupName, `Processing ${groupFields.length} fields`);
        
        const groupResults = await this.processFieldGroup(
          groupFields,
          fieldPageMappings,
          images,
          extractedText,
          strategy
        );
        
        results.push(...groupResults);
      }

      const totalTime = Date.now() - startTime;
      this.prodLogger.performance('large_pdf', 'vision_processing', totalTime / 1000, `${results.length} fields`);
      
      return results;

    } catch (error) {
      this.logger.error(`❌ Large PDF vision processing failed: ${error.message}`);
      
      // Fallback: procesamiento básico página por página
      return this.fallbackBasicProcessing(prompts, images, strategy);
    }
  }

  /**
   * Determina estrategia de procesamiento basada en características del archivo
   */
  private determineProcessingStrategy(
    fileSizeMB: number, 
    pageCount: number, 
    textLength: number
  ): ProcessingStrategy {
    
    const config = largePdfConfig.getOptimizedConfigForFile(fileSizeMB, textLength, pageCount);
    
    // Para archivos ultra-grandes (90MB+), máxima optimización
    if (fileSizeMB >= largePdfConfig.thresholds.ultraLargeSizeLimit) {
      return {
        useTargetedPages: true,
        maxPagesPerField: 3, // Máximo 3 páginas por campo
        enableEarlyExit: true,
        useGeminiPrimary: true, // Gemini es mejor para docs largos
        allowPartialAnalysis: true,
      };
    }

    // Para archivos grandes (50-90MB), optimización moderada
    if (fileSizeMB >= largePdfConfig.thresholds.standardSizeLimit) {
      return {
        useTargetedPages: true,
        maxPagesPerField: largePdfConfig.thresholds.maxPagesPerField,
        enableEarlyExit: true,
        useGeminiPrimary: config.strategy === 'vision-chunked',
        allowPartialAnalysis: false,
      };
    }

    // Para archivos medianos, estrategia balanceada
    return {
      useTargetedPages: false,
      maxPagesPerField: 10,
      enableEarlyExit: false,
      useGeminiPrimary: false,
      allowPartialAnalysis: false,
    };
  }

  /**
   * Agrupa campos por complejidad para procesamiento eficiente
   */
  private groupFieldsByComplexity(
    prompts: Array<{pmc_field: string, question: string, expected_type: ResponseType}>,
    fieldPageMappings: {[field: string]: FieldPageMapping}
  ): {[groupName: string]: Array<{pmc_field: string, question: string, expected_type: ResponseType}>} {
    
    const groups = {
      simple: [] as Array<{pmc_field: string, question: string, expected_type: ResponseType}>,
      signature: [] as Array<{pmc_field: string, question: string, expected_type: ResponseType}>,
      complex: [] as Array<{pmc_field: string, question: string, expected_type: ResponseType}>,
      comprehensive: [] as Array<{pmc_field: string, question: string, expected_type: ResponseType}>
    };

    for (const prompt of prompts) {
      const mapping = fieldPageMappings[prompt.pmc_field];
      const field = prompt.pmc_field.toLowerCase();
      const question = prompt.question.toLowerCase();

      // Clasificación inteligente
      if (prompt.pmc_field.includes('comprehensive') || question.includes('go through the document')) {
        groups.comprehensive.push(prompt);
      } else if (field.includes('sign') || question.includes('signature')) {
        groups.signature.push(prompt);
      } else if (mapping && mapping.targetPages.length > 3) {
        groups.complex.push(prompt);
      } else {
        groups.simple.push(prompt);
      }
    }

    // Log de grupos para debugging
    this.logger.debug(`📊 Field grouping: simple=${groups.simple.length}, signature=${groups.signature.length}, complex=${groups.complex.length}, comprehensive=${groups.comprehensive.length}`);

    return groups;
  }

  /**
   * Procesa un grupo de campos relacionados
   */
  private async processFieldGroup(
    fields: Array<{pmc_field: string, question: string, expected_type: ResponseType}>,
    fieldPageMappings: {[field: string]: FieldPageMapping},
    images: Buffer[],
    extractedText: string,
    strategy: ProcessingStrategy
  ): Promise<LargePdfProcessingResult[]> {

    const results: LargePdfProcessingResult[] = [];
    const concurrency = strategy.useGeminiPrimary ? 2 : 3; // Gemini puede manejar menos concurrencia

    // Procesar campos en batches para controlar memoria y rate limits
    for (let i = 0; i < fields.length; i += concurrency) {
      const batch = fields.slice(i, i + concurrency);
      const batchPromises = batch.map(field => 
        this.processIndividualField(field, fieldPageMappings[field.pmc_field], images, extractedText, strategy)
      );

      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            this.logger.error(`Field processing failed: ${result.reason}`);
          }
        }

        // Rate limiting delay entre batches
        if (i + concurrency < fields.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        this.logger.error(`Batch processing error: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Procesa un campo individual con targeting inteligente
   */
  private async processIndividualField(
    field: {pmc_field: string, question: string, expected_type: ResponseType},
    pageMapping: FieldPageMapping,
    images: Buffer[],
    extractedText: string,
    strategy: ProcessingStrategy
  ): Promise<LargePdfProcessingResult> {

    const startTime = Date.now();
    
    try {
      // Determinar páginas a analizar
      let targetPages: number[];
      
      if (strategy.useTargetedPages && pageMapping) {
        targetPages = pageMapping.targetPages.slice(0, strategy.maxPagesPerField);
        this.logger.debug(`🎯 ${field.pmc_field}: targeting pages [${targetPages.join(', ')}] (${pageMapping.reasoning})`);
      } else {
        // Fallback: usar heurísticas simples
        targetPages = this.getHeuristicPages(field, images.length, strategy.maxPagesPerField);
        this.logger.debug(`🔄 ${field.pmc_field}: using heuristic pages [${targetPages.join(', ')}]`);
      }

      // Seleccionar imágenes correspondientes
      const targetImages = targetPages
        .filter(pageNum => pageNum > 0 && pageNum <= images.length)
        .map(pageNum => images[pageNum - 1]); // Convert to 0-based index

      if (targetImages.length === 0) {
        throw new Error('No valid target images found');
      }

      // Procesar con el modelo apropiado
      let result;
      let processingStrategy: string;

      if (strategy.useGeminiPrimary) {
        result = await this.processWithGeminiVision(field, targetImages, extractedText, strategy);
        processingStrategy = 'targeted-vision-gemini';
      } else {
        result = await this.processWithDualVision(field, targetImages, extractedText, strategy);
        processingStrategy = 'targeted-vision-dual';
      }

      const processingTime = Date.now() - startTime;

      return {
        pmc_field: field.pmc_field,
        answer: result.answer,
        confidence: result.confidence,
        processing_time_ms: processingTime,
        pages_analyzed: targetPages,
        strategy_used: processingStrategy as any,
        reasoning: `Analyzed ${targetImages.length} pages: ${targetPages.join(', ')}`
      };

    } catch (error) {
      this.logger.error(`❌ ${field.pmc_field} processing failed: ${error.message}`);
      
      const processingTime = Date.now() - startTime;
      
      return {
        pmc_field: field.pmc_field,
        answer: 'NOT_FOUND',
        confidence: 0.1,
        processing_time_ms: processingTime,
        pages_analyzed: [],
        strategy_used: 'targeted-vision',
        reasoning: `Failed: ${error.message}`
      };
    }
  }

  /**
   * Procesamiento con Gemini Vision (optimizado para documentos grandes)
   */
  private async processWithGeminiVision(
    field: {pmc_field: string, question: string, expected_type: ResponseType},
    targetImages: Buffer[],
    extractedText: string,
    strategy: ProcessingStrategy
  ): Promise<{answer: string, confidence: number}> {

    try {
      // Para múltiples páginas, usar análisis secuencial con early exit
      if (targetImages.length > 1 && strategy.enableEarlyExit) {
        return await this.processWithEarlyExit(field, targetImages, 'gemini');
      }

      // Para página única, análisis directo
      // Convertir Buffer a base64 para la primera imagen
      const imageBase64 = targetImages[0].toString('base64');
      const result = await this.geminiService.analyzeWithVision(
        imageBase64,
        field.question,
        field.expected_type,
        field.pmc_field,
        1
      );

      return {
        answer: result.response,
        confidence: result.confidence
      };

    } catch (error) {
      this.logger.warn(`⚠️ Gemini vision failed for ${field.pmc_field}: ${error.message}`);
      
      // Fallback a texto si disponible
      if (extractedText && extractedText.length > 1000) {
        try {
          const textResult = await this.geminiService.evaluateDocument(
            extractedText,
            field.question,
            field.expected_type,
            '',
            field.pmc_field
          );
          
          return {
            answer: textResult.response,
            confidence: textResult.confidence * 0.8 // Penalizar por usar fallback
          };
        } catch (textError) {
          throw new Error(`Both vision and text failed: ${error.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Procesamiento dual con GPT-4o Vision + Gemini Vision
   */
  private async processWithDualVision(
    field: {pmc_field: string, question: string, expected_type: ResponseType},
    targetImages: Buffer[],
    extractedText: string,
    strategy: ProcessingStrategy
  ): Promise<{answer: string, confidence: number}> {

    try {
      const isSignatureField = field.pmc_field.toLowerCase().includes('sign');
      
      // Para campos de firma, procesar múltiples páginas; para otros, solo la primera
      const imagesToProcess = isSignatureField ? targetImages : [targetImages[0]];
      
      this.prodLogger.lopDebug('large_pdf', field.pmc_field, `SignatureField=${isSignatureField}, Images=${imagesToProcess.length}/${targetImages.length}`);
      
      let bestGptResult: any = null;
      let bestGeminiResult: any = null;
      let bestConfidence = 0;
      
      // Procesar cada página
      for (let i = 0; i < imagesToProcess.length; i++) {
        const imageBase64 = imagesToProcess[i].toString('base64');
        const pageNumber = i + 1;
        
        this.prodLogger.debug('large_pdf', field.pmc_field, `Processing page ${pageNumber}/${imagesToProcess.length}, ${(imageBase64.length / 1024).toFixed(1)}KB`);
        
        const gptResult = await this.openaiService.evaluateWithVision(
          imageBase64,
          field.question,
          field.expected_type,
          field.pmc_field,
          pageNumber
        );

        this.prodLogger.visionApiLog('large_pdf', field.pmc_field, pageNumber, 'GPT-4o', gptResult.response);
        
        // DIAGNOSTIC: Log GPT result structure
        this.logger.log(`🔍 DIAGNOSTIC [${field.pmc_field}] GPT Result: ${JSON.stringify({
          response: gptResult.response,
          confidence: gptResult.confidence,
          hasResponse: !!gptResult.response,
          responseType: typeof gptResult.response
        })}`);

        const geminiResult = await this.geminiService.analyzeWithVision(
          imageBase64,
          field.question,
          field.expected_type,
          field.pmc_field,
          pageNumber
        );

        this.prodLogger.visionApiLog('large_pdf', field.pmc_field, pageNumber, 'Gemini', typeof geminiResult.response === 'string' ? geminiResult.response : JSON.stringify(geminiResult.response || geminiResult));
        
        // DIAGNOSTIC: Log Gemini result structure  
        this.logger.log(`🔍 DIAGNOSTIC [${field.pmc_field}] Gemini Result: ${JSON.stringify({
          response: geminiResult.response,
          confidence: geminiResult.confidence,
          hasResponse: !!geminiResult.response,
          responseType: typeof geminiResult.response,
          fullObject: geminiResult
        })}`);
        
        // DIAGNOSTIC: Log dual vision decision making
        this.logger.log(`🔍 DIAGNOSTIC [${field.pmc_field}] Decision making: GPT="${gptResult.response}" (${gptResult.confidence}) vs Gemini="${geminiResult.response}" (${geminiResult.confidence})`);

        // Para campos de firma booleanos, early exit en YES con buena confianza
        if (isSignatureField && field.expected_type === ResponseType.BOOLEAN) {
          if (gptResult.response === 'YES' && gptResult.confidence >= 0.7) {
            this.logger.log(`✅ EARLY EXIT Page ${pageNumber}: GPT found signature (confidence: ${gptResult.confidence})`);
            return {
              answer: gptResult.response,
              confidence: gptResult.confidence
            };
          }
          if (geminiResult.response === 'YES' && geminiResult.confidence >= 0.7) {
            this.logger.log(`✅ EARLY EXIT Page ${pageNumber}: Gemini found signature (confidence: ${geminiResult.confidence})`);
            return {
              answer: geminiResult.response,
              confidence: geminiResult.confidence
            };
          }
        }

        // Almacenar mejor resultado hasta ahora
        const pageConfidence = Math.max(gptResult.confidence, geminiResult.confidence);
        if (pageConfidence > bestConfidence) {
          bestConfidence = pageConfidence;
          bestGptResult = gptResult;
          bestGeminiResult = geminiResult;
        }
      }

      // Si no encontramos early exit, usar mejor resultado general
      this.logger.log(`📊 LOP FINAL: ${field.pmc_field} - No early exit found, using best results: GPT="${bestGptResult?.response}" (${bestGptResult?.confidence}), Gemini="${bestGeminiResult?.response}" (${bestGeminiResult?.confidence})`);
      
      const consensus = this.calculateConsensus(bestGptResult.response, bestGeminiResult.response);
      
      if (consensus.agreement >= 0.8) {
        this.logger.log(`✅ LOP CONSENSUS: ${field.pmc_field} - Agreement ${consensus.agreement} ≥ 0.8, Final: "${consensus.finalAnswer}"`);
        return {
          answer: consensus.finalAnswer,
          confidence: Math.max(bestGptResult.confidence, bestGeminiResult.confidence)
        };
      }

      // Bajo consenso: usar respuesta con mayor confianza
      if (bestGeminiResult.confidence > bestGptResult.confidence) {
        this.logger.log(`🔄 LOP FALLBACK: ${field.pmc_field} - Using Gemini "${bestGeminiResult.response}" (${bestGeminiResult.confidence} vs ${bestGptResult.confidence})`);
        return {
          answer: bestGeminiResult.response,
          confidence: bestGeminiResult.confidence
        };
      } else {
        this.logger.log(`🔄 LOP FALLBACK: ${field.pmc_field} - Using GPT-4o "${bestGptResult.response}" (${bestGptResult.confidence} vs ${bestGeminiResult.confidence})`);
        return {
          answer: bestGptResult.response,
          confidence: bestGptResult.confidence
        };
      }

    } catch (error) {
      this.logger.error(`❌ Dual vision failed for ${field.pmc_field}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Procesamiento con early exit - analiza páginas hasta encontrar respuesta confiable
   */
  private async processWithEarlyExit(
    field: {pmc_field: string, question: string, expected_type: ResponseType},
    targetImages: Buffer[],
    model: 'gemini' | 'dual'
  ): Promise<{answer: string, confidence: number}> {

    for (let i = 0; i < targetImages.length; i++) {
      const pageImageBase64 = targetImages[i].toString('base64');
      
      try {
        let result;
        
        if (model === 'gemini') {
          result = await this.geminiService.analyzeWithVision(
            pageImageBase64,
            field.question,
            field.expected_type,
            field.pmc_field,
            i + 1
          );
        } else {
          result = await this.processWithDualVision(field, [targetImages[i]], '', {
            useTargetedPages: true,
            maxPagesPerField: 1,
            enableEarlyExit: false,
            useGeminiPrimary: false,
            allowPartialAnalysis: true
          });
        }

        // Early exit si encontramos respuesta confiable
        if (result.confidence >= 0.8 && result.response !== 'NOT_FOUND') {
          this.logger.debug(`✅ Early exit for ${field.pmc_field}: found answer on page ${i + 1} (confidence: ${result.confidence})`);
          return {
            answer: result.response,
            confidence: result.confidence
          };
        }

        // Para campos de firma, early exit en respuestas positivas
        if (field.pmc_field.toLowerCase().includes('sign') && 
            result.response === 'YES' && 
            result.confidence >= 0.6) {
          this.logger.debug(`✅ Signature early exit for ${field.pmc_field}: found positive on page ${i + 1}`);
          return {
            answer: result.response,
            confidence: result.confidence
          };
        }

      } catch (error) {
        this.logger.debug(`⚠️ Page ${i + 1} failed for ${field.pmc_field}: ${error.message}`);
        continue;
      }
    }

    // Si no encontramos respuesta confiable en ninguna página
    return {
      answer: 'NOT_FOUND',
      confidence: 0.3
    };
  }

  /**
   * Calcula consenso entre dos respuestas
   */
  private calculateConsensus(answer1: string, answer2: string): {agreement: number, finalAnswer: string} {
    if (!answer1 || !answer2) {
      return {agreement: 0, finalAnswer: answer1 || answer2 || 'NOT_FOUND'};
    }

    const normalized1 = answer1.toLowerCase().trim();
    const normalized2 = answer2.toLowerCase().trim();

    // Exact match
    if (normalized1 === normalized2) {
      return {agreement: 1.0, finalAnswer: answer1};
    }

    // Boolean consensus
    const booleanWords = ['yes', 'no', 'true', 'false'];
    if (booleanWords.includes(normalized1) && booleanWords.includes(normalized2)) {
      const both_positive = ['yes', 'true'].includes(normalized1) && ['yes', 'true'].includes(normalized2);
      const both_negative = ['no', 'false'].includes(normalized1) && ['no', 'false'].includes(normalized2);
      
      if (both_positive || both_negative) {
        return {agreement: 1.0, finalAnswer: 'YES'};
      } else {
        return {agreement: 0.0, finalAnswer: answer1};
      }
    }

    // Numerical consensus
    const num1 = parseFloat(normalized1);
    const num2 = parseFloat(normalized2);
    if (!isNaN(num1) && !isNaN(num2)) {
      const diff = Math.abs(num1 - num2);
      const avg = (num1 + num2) / 2;
      const percentageDiff = avg === 0 ? 0 : diff / avg;
      
      if (percentageDiff < 0.1) { // Less than 10% difference
        return {agreement: 0.9, finalAnswer: answer1};
      }
    }

    // String similarity (simplified)
    const similarity = this.stringSimilarity(normalized1, normalized2);
    return {agreement: similarity, finalAnswer: answer1};
  }

  /**
   * Calcula similitud entre strings (Jaccard simplificado)
   */
  private stringSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Páginas heurísticas para campos sin mapping AI
   */
  private getHeuristicPages(
    field: {pmc_field: string, question: string},
    totalPages: number,
    maxPages: number
  ): number[] {
    
    const fieldLower = field.pmc_field.toLowerCase();
    const questionLower = field.question.toLowerCase();
    
    // Firmas: últimas páginas
    if (fieldLower.includes('sign') || questionLower.includes('signature')) {
      const lastPages = [];
      for (let i = Math.max(1, totalPages - 2); i <= totalPages; i++) {
        lastPages.push(i);
      }
      return lastPages.slice(0, maxPages);
    }
    
    // Fechas, nombres, números de póliza: primeras páginas
    if (fieldLower.includes('date') || fieldLower.includes('name') || 
        fieldLower.includes('policy') || fieldLower.includes('insured')) {
      const firstPages = [];
      for (let i = 1; i <= Math.min(maxPages, 3, totalPages); i++) {
        firstPages.push(i);
      }
      return firstPages;
    }
    
    // Análisis comprensivo: muestra representativa
    if (fieldLower.includes('comprehensive') || questionLower.includes('go through')) {
      const pages = [1]; // Primera página siempre
      
      if (totalPages > 2) {
        pages.push(Math.ceil(totalPages / 2)); // Página del medio
      }
      
      if (totalPages > 1) {
        pages.push(totalPages); // Última página
      }
      
      return pages.slice(0, maxPages);
    }
    
    // Default: primera y última página
    const defaultPages = [1];
    if (totalPages > 1) {
      defaultPages.push(totalPages);
    }
    return defaultPages.slice(0, maxPages);
  }

  /**
   * Procesamiento básico como fallback
   */
  private async fallbackBasicProcessing(
    prompts: Array<{pmc_field: string, question: string, expected_type: ResponseType}>,
    images: Buffer[],
    strategy: ProcessingStrategy
  ): Promise<LargePdfProcessingResult[]> {
    
    this.logger.warn('🔄 Using fallback basic processing');
    
    const results: LargePdfProcessingResult[] = [];
    
    for (const field of prompts) {
      const startTime = Date.now();
      
      try {
        // Usar solo primera y última página como fallback ultra-conservador
        const fallbackImages = [images[0]];
        if (images.length > 1) {
          fallbackImages.push(images[images.length - 1]);
        }
        
        // Usar solo la primera imagen del fallback
        const imageBase64 = fallbackImages[0].toString('base64');
        const result = await this.geminiService.analyzeWithVision(
          imageBase64,
          field.question,
          field.expected_type,
          field.pmc_field,
          1
        );
        
        results.push({
          pmc_field: field.pmc_field,
          answer: result.response,
          confidence: result.confidence * 0.7, // Penalizar por usar fallback
          processing_time_ms: Date.now() - startTime,
          pages_analyzed: [1, images.length].slice(0, fallbackImages.length),
          strategy_used: 'comprehensive-scan',
          reasoning: 'Fallback processing - first and last pages only'
        });
        
      } catch (error) {
        results.push({
          pmc_field: field.pmc_field,
          answer: 'NOT_FOUND',
          confidence: 0.1,
          processing_time_ms: Date.now() - startTime,
          pages_analyzed: [],
          strategy_used: 'comprehensive-scan',
          reasoning: `Fallback failed: ${error.message}`
        });
      }
    }
    
    return results;
  }

  /**
   * NUEVO: Procesa prompt consolidado que espera UNA respuesta con múltiples valores separados por semicolons
   * Diseñado específicamente para prompts de la tabla document_consolidado
   */
  async processConsolidatedPromptWithVision(
    consolidatedPrompt: {
      pmc_field: string,
      question: string,
      expected_fields: string[],
      expected_type: ResponseType
    },
    images: Buffer[],
    extractedText: string,
    fileSizeMB: number
  ): Promise<{answer: string, confidence: number, processing_time_ms: number}> {

    this.prodLogger.strategyDebug('consolidated_prompt', 'processing_start', 
      `${fileSizeMB.toFixed(2)}MB, ${images.length} pages, expecting ${consolidatedPrompt.expected_fields.length} fields in one response`);

    const startTime = Date.now();
    
    try {
      // Determinar estrategia de procesamiento para prompt consolidado
      const strategy = this.determineProcessingStrategy(fileSizeMB, images.length, extractedText.length);
      
      this.logger.log(`🏗️ CONSOLIDATED PROCESSING for ${consolidatedPrompt.pmc_field}:`);
      this.logger.log(`   - Expected fields: ${consolidatedPrompt.expected_fields.length}`);
      this.logger.log(`   - Strategy: ${strategy.useGeminiPrimary ? 'Gemini Primary' : 'GPT-4o Primary'}`);
      this.logger.log(`   - Use targeted pages: ${strategy.useTargetedPages}`);
      
      // Para prompts consolidados, necesitamos análisis más comprehensivo
      // No podemos usar "early exit" porque necesitamos todos los campos
      const consolidatedStrategy: ProcessingStrategy = {
        ...strategy,
        enableEarlyExit: false,  // CRÍTICO: No early exit para prompts consolidados
        allowPartialAnalysis: false,  // CRÍTICO: Necesitamos análisis completo
        useTargetedPages: false,  // CRÍTICO: Analizar todas las páginas relevantes
        maxPagesPerField: Math.min(images.length, 10)  // Permitir más páginas para análisis completo
      };
      
      this.logger.log(`🎯 Consolidated strategy adjusted: targetedPages=${consolidatedStrategy.useTargetedPages}, maxPages=${consolidatedStrategy.maxPagesPerField}`);


      let result: {answer: string, confidence: number};

      // Procesar según estrategia optimizada
      if (consolidatedStrategy.useGeminiPrimary) {
        result = await this.processConsolidatedWithGemini(
          consolidatedPrompt, 
          images, 
          extractedText, 
          consolidatedStrategy
        );
      } else {
        result = await this.processConsolidatedWithDualVision(
          consolidatedPrompt, 
          images, 
          extractedText, 
          consolidatedStrategy
        );
      }

      const processingTime = Date.now() - startTime;
      
      // Validar que la respuesta tenga el formato esperado (semicolons)
      const responseValues = result.answer.split(';');
      this.logger.log(`🔍 CONSOLIDATED RESPONSE VALIDATION:`);
      this.logger.log(`   - Raw response: "${result.answer}"`);
      this.logger.log(`   - Split values: ${responseValues.length}`);
      this.logger.log(`   - Expected fields: ${consolidatedPrompt.expected_fields.length}`);
      
      // Si no coincide el número de valores, completar o truncar
      let finalAnswer = result.answer;
      if (responseValues.length !== consolidatedPrompt.expected_fields.length) {
        this.logger.warn(`⚠️ Response mismatch: got ${responseValues.length} values, expected ${consolidatedPrompt.expected_fields.length}`);
        
        // Completar con NOT_FOUND si faltan valores
        while (responseValues.length < consolidatedPrompt.expected_fields.length) {
          responseValues.push('NOT_FOUND');
        }
        
        // Truncar si hay demasiados valores
        const adjustedValues = responseValues.slice(0, consolidatedPrompt.expected_fields.length);
        finalAnswer = adjustedValues.join(';');
        
        this.logger.log(`🔧 Adjusted response: "${finalAnswer}"`);
      }

      this.prodLogger.performance('consolidated_prompt', 'vision_processing', 
        processingTime / 1000, `1 consolidated response with ${consolidatedPrompt.expected_fields.length} fields`);

      return {
        answer: finalAnswer,
        confidence: result.confidence,
        processing_time_ms: processingTime
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`❌ Consolidated prompt processing failed for ${consolidatedPrompt.pmc_field}: ${error.message}`);
      
      // Fallback: devolver NOT_FOUND para todos los campos esperados
      const fallbackAnswer = Array(consolidatedPrompt.expected_fields.length).fill('NOT_FOUND').join(';');
      
      return {
        answer: fallbackAnswer,
        confidence: 0.1,
        processing_time_ms: processingTime
      };
    }
  }

  /**
   * Procesamiento consolidado usando Gemini Vision como primary
   */
  private async processConsolidatedWithGemini(
    consolidatedPrompt: {
      pmc_field: string,
      question: string,
      expected_fields: string[],
      expected_type: ResponseType
    },
    images: Buffer[],
    extractedText: string,
    strategy: ProcessingStrategy
  ): Promise<{answer: string, confidence: number}> {

    try {
      this.logger.log(`🤖 Processing consolidated prompt with Gemini Primary`);
      
      // Para prompts consolidados, usar múltiples páginas en secuencia
      // Gemini puede procesar mejor documentos largos y complejos
      
      let bestResult: {answer: string, confidence: number} = {
        answer: Array(consolidatedPrompt.expected_fields.length).fill('NOT_FOUND').join(';'),
        confidence: 0
      };
      
      // Procesar con múltiples imágenes para mejor cobertura
      const maxImagesToProcess = Math.min(images.length, strategy.maxPagesPerField);
      
      for (let i = 0; i < maxImagesToProcess; i++) {
        const imageBase64 = images[i].toString('base64');
        
        try {
          const result = await this.geminiService.analyzeWithVision(
            imageBase64,
            consolidatedPrompt.question,
            consolidatedPrompt.expected_type,
            consolidatedPrompt.pmc_field,
            i + 1
          );

          this.logger.log(`📊 Gemini page ${i + 1} result: "${result.response}" (confidence: ${result.confidence})`);
          
          // Si este resultado tiene mejor confianza, usarlo
          if (result.confidence > bestResult.confidence) {
            bestResult = {
              answer: result.response,
              confidence: result.confidence
            };
            
            this.logger.log(`✅ New best result from page ${i + 1}: confidence ${result.confidence}`);
          }
          
        } catch (pageError) {
          this.logger.warn(`⚠️ Gemini failed on page ${i + 1}: ${pageError.message}`);
          continue;
        }
      }
      
      return bestResult;

    } catch (error) {
      this.logger.error(`❌ Consolidated Gemini processing failed: ${error.message}`);
      
      // Fallback a texto si está disponible
      if (extractedText && extractedText.length > 1000) {
        try {
          const textResult = await this.geminiService.evaluateDocument(
            extractedText,
            consolidatedPrompt.question,
            consolidatedPrompt.expected_type,
            '',
            consolidatedPrompt.pmc_field
          );
          
          return {
            answer: textResult.response,
            confidence: textResult.confidence * 0.8  // Penalizar por usar fallback
          };
        } catch (textError) {
          throw new Error(`Both Gemini vision and text failed: ${error.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Procesamiento consolidado usando dual vision (GPT-4o + Gemini)
   */
  private async processConsolidatedWithDualVision(
    consolidatedPrompt: {
      pmc_field: string,
      question: string,
      expected_fields: string[],
      expected_type: ResponseType
    },
    images: Buffer[],
    extractedText: string,
    strategy: ProcessingStrategy
  ): Promise<{answer: string, confidence: number}> {

    try {
      this.logger.log(`🤖 Processing consolidated prompt with Dual Vision (GPT-4o + Gemini)`);
      
      const maxImagesToProcess = Math.min(images.length, strategy.maxPagesPerField);
      
      let bestGptResult: any = null;
      let bestGeminiResult: any = null;
      let bestGptConfidence = 0;
      let bestGeminiConfidence = 0;
      
      // Procesar páginas clave para obtener mejores resultados
      for (let i = 0; i < maxImagesToProcess; i++) {
        const imageBase64 = images[i].toString('base64');
        const pageNumber = i + 1;
        
        try {
          // GPT-4o Vision
          const gptResult = await this.openaiService.evaluateWithVision(
            imageBase64,
            consolidatedPrompt.question,
            consolidatedPrompt.expected_type,
            consolidatedPrompt.pmc_field,
            pageNumber
          );

          this.logger.log(`🔍 GPT-4o page ${pageNumber} result: "${gptResult.response}" (confidence: ${gptResult.confidence})`);
          
          if (gptResult.confidence > bestGptConfidence) {
            bestGptResult = gptResult;
            bestGptConfidence = gptResult.confidence;
          }

        } catch (gptError) {
          this.logger.warn(`⚠️ GPT-4o failed on page ${pageNumber}: ${gptError.message}`);
        }

        try {
          // Gemini Vision
          const geminiResult = await this.geminiService.analyzeWithVision(
            imageBase64,
            consolidatedPrompt.question,
            consolidatedPrompt.expected_type,
            consolidatedPrompt.pmc_field,
            pageNumber
          );

          this.logger.log(`🔍 Gemini page ${pageNumber} result: "${geminiResult.response}" (confidence: ${geminiResult.confidence})`);
          
          if (geminiResult.confidence > bestGeminiConfidence) {
            bestGeminiResult = geminiResult;
            bestGeminiConfidence = geminiResult.confidence;
          }

        } catch (geminiError) {
          this.logger.warn(`⚠️ Gemini failed on page ${pageNumber}: ${geminiError.message}`);
        }
      }
      
      // Seleccionar mejor resultado basado en consenso y confianza
      if (!bestGptResult && !bestGeminiResult) {
        throw new Error('Both GPT-4o and Gemini failed for all pages');
      }
      
      if (!bestGptResult) {
        this.logger.log(`🔄 Using Gemini result (GPT-4o failed): "${bestGeminiResult.response}" (${bestGeminiResult.confidence})`);
        return {
          answer: bestGeminiResult.response,
          confidence: bestGeminiResult.confidence
        };
      }
      
      if (!bestGeminiResult) {
        this.logger.log(`🔄 Using GPT-4o result (Gemini failed): "${bestGptResult.response}" (${bestGptResult.confidence})`);
        return {
          answer: bestGptResult.response,
          confidence: bestGptResult.confidence
        };
      }
      
      // Ambos modelos tienen resultados - calcular consenso
      let consensus = this.calculateConsensus(bestGptResult.response, bestGeminiResult.response);
      
      this.logger.log(`📊 DUAL VISION CONSENSUS: Agreement=${consensus.agreement}, Final="${consensus.finalAnswer}"`);
      this.logger.log(`   GPT-4o: "${bestGptResult.response}" (${bestGptResult.confidence})`);
      this.logger.log(`   Gemini: "${bestGeminiResult.response}" (${bestGeminiResult.confidence})`);
      
      // 🚀 NUEVA ESTRATEGIA: FORZAR VISIÓN PARA NOT_FOUND
      if (consensus.agreement < 0.8 || this.hasHighNotFoundRate(consensus.finalAnswer)) {
        this.logger.log(`🔴 ACTIVANDO VISIÓN FORZADA: Low consensus (${consensus.agreement}) OR high NOT_FOUND rate`);
        
        const forcedVisionResult = await this.performForcedVisionAnalysis(
          consolidatedPrompt, 
          images, 
          extractedText, 
          bestGptResult, 
          bestGeminiResult
        );
        
        if (forcedVisionResult.improved) {
          this.logger.log(`✅ Forced vision improved results: ${forcedVisionResult.confidence}`);
          return {
            answer: forcedVisionResult.answer,
            confidence: forcedVisionResult.confidence
          };
        }
      }
      
      if (consensus.agreement >= 0.8) {
        const finalConfidence = Math.max(bestGptResult.confidence, bestGeminiResult.confidence);
        this.logger.log(`✅ High consensus (${consensus.agreement}) - Final confidence: ${finalConfidence}`);
        return {
          answer: consensus.finalAnswer,
          confidence: finalConfidence
        };
      }
      
      // Bajo consenso: usar el resultado con mayor confianza
      if (bestGeminiResult.confidence > bestGptResult.confidence) {
        this.logger.log(`🔄 Low consensus - Using Gemini (higher confidence): ${bestGeminiResult.confidence} vs ${bestGptResult.confidence}`);
        return {
          answer: bestGeminiResult.response,
          confidence: bestGeminiResult.confidence
        };
      } else {
        this.logger.log(`🔄 Low consensus - Using GPT-4o (higher confidence): ${bestGptResult.confidence} vs ${bestGeminiResult.confidence}`);
        return {
          answer: bestGptResult.response,
          confidence: bestGptResult.confidence
        };
      }

    } catch (error) {
      this.logger.error(`❌ Dual vision consolidated processing failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 🔥 NUEVA FUNCIÓN: Detecta si hay muchos NOT_FOUND en la respuesta
   */
  private hasHighNotFoundRate(answer: string): boolean {
    const values = answer.split(';');
    const notFoundCount = values.filter(v => v.trim() === 'NOT_FOUND').length;
    const notFoundRate = notFoundCount / values.length;
    
    this.logger.log(`📊 NOT_FOUND rate: ${notFoundCount}/${values.length} (${(notFoundRate * 100).toFixed(1)}%)`);
    
    // 🚀 ULTRA AGRESIVO: Si más del 40% son NOT_FOUND, activar visión forzada
    const isHighRate = notFoundRate > 0.4;
    this.logger.log(`🎯 Ultra-aggressive threshold (40%): ${isHighRate ? 'TRIGGERED' : 'OK'}`);
    
    return isHighRate;
  }

  /**
   * 🚀 NUEVA FUNCIÓN: Análisis de visión forzada con estrategias múltiples
   */
  private async performForcedVisionAnalysis(
    consolidatedPrompt: any,
    images: Buffer[],
    extractedText: string,
    bestGptResult: any,
    bestGeminiResult: any
  ): Promise<{answer: string, confidence: number, improved: boolean}> {
    
    this.logger.log(`🔥 INICIANDO VISIÓN FORZADA ULTRA-AGRESIVA con ${images.length} páginas`);
    
    try {
      // 💾 RETENCIÓN TEMPORAL: Guardar valores del primer método
      const temporalValues = this.extractTemporalValues(bestGptResult.response, bestGeminiResult.response);
      this.logger.log(`💾 Valores temporales retenidos: ${temporalValues.length} campos con datos`);
      
      // ESTRATEGIA 1: Análisis con prompts ultra-específicos + retención temporal
      const enhancedResults = await this.performEnhancedVisionAnalysis(
        consolidatedPrompt, 
        images, 
        extractedText
      );
      
      // ESTRATEGIA 2: Análisis por micro-chunks de campos
      const chunkResults = await this.performChunkedFieldAnalysis(
        consolidatedPrompt, 
        images,
        extractedText
      );
      
      // 🎯 ESTRATEGIA 3: SUMA PROGRESIVA - Combinar con retención temporal
      const progressiveCombinedResult = this.combineProgressiveResults([
        {answer: bestGptResult.response, confidence: bestGptResult.confidence, source: 'gpt-original', priority: 1},
        {answer: bestGeminiResult.response, confidence: bestGeminiResult.confidence, source: 'gemini-original', priority: 1},
        {answer: enhancedResults.answer, confidence: enhancedResults.confidence, source: 'ultra-enhanced-vision', priority: 2},
        {answer: chunkResults.answer, confidence: chunkResults.confidence, source: 'micro-chunked-analysis', priority: 3}
      ], temporalValues, consolidatedPrompt.expected_fields);
      
      this.logger.log(`🎯 Progressive combined result: "${progressiveCombinedResult.answer}" (confidence: ${progressiveCombinedResult.confidence})`);
      
      // Verificar mejora ultra-agresiva
      const originalNotFoundRate = this.calculateNotFoundRate(bestGptResult.response);
      const improvedNotFoundRate = this.calculateNotFoundRate(progressiveCombinedResult.answer);
      const improved = improvedNotFoundRate < originalNotFoundRate - 0.05; // Mejora del 5%
      
      this.logger.log(`📈 ULTRA-AGGRESSIVE improvement: ${originalNotFoundRate.toFixed(2)} → ${improvedNotFoundRate.toFixed(2)} (improved: ${improved})`);
      
      return {
        answer: progressiveCombinedResult.answer,
        confidence: progressiveCombinedResult.confidence,
        improved: improved
      };
      
    } catch (error) {
      this.logger.error(`❌ Forced vision analysis failed: ${error.message}`);
      return {
        answer: bestGptResult.response || bestGeminiResult.response,
        confidence: Math.max(bestGptResult.confidence || 0, bestGeminiResult.confidence || 0),
        improved: false
      };
    }
  }

  /**
   * 🔍 ESTRATEGIA 1: Análisis con prompts mejorados
   */
  private async performEnhancedVisionAnalysis(
    consolidatedPrompt: any,
    images: Buffer[],
    extractedText: string
  ): Promise<{answer: string, confidence: number}> {
    
    // Crear prompt más específico y detallado
    const enhancedPrompt = `
${consolidatedPrompt.question}

IMPORTANT INSTRUCTIONS:
- Look very carefully at ALL visible text, numbers, dates, and signatures
- Check every corner, margin, header, and footer of the document
- If information seems partially visible or unclear, make your best educated guess
- Only use NOT_FOUND if you are absolutely certain the information is not present anywhere
- For dates, look for any format: MM/DD/YY, MM-DD-YY, DD/MM/YY, written dates, etc.
- For signatures, look for any handwritten marks, initials, or electronic signatures
- For addresses, check letterheads, forms, and any printed information
- Use text information from OCR if visual analysis is unclear

OCR TEXT REFERENCE:
${extractedText.substring(0, 5000)}...
`;

    let bestResult = null;
    let bestConfidence = 0;
    
    // Analizar cada página con el prompt mejorado
    for (let i = 0; i < Math.min(images.length, 3); i++) {
      const imageBase64 = images[i].toString('base64');
      
      try {
        // Usar ambos modelos con prompt mejorado
        const [gptResult, geminiResult] = await Promise.allSettled([
          this.openaiService.evaluateWithVision(
            imageBase64,
            enhancedPrompt,
            consolidatedPrompt.expected_type,
            `${consolidatedPrompt.pmc_field}_enhanced`,
            i + 1
          ),
          this.geminiService.analyzeWithVision(
            imageBase64,
            enhancedPrompt,
            consolidatedPrompt.expected_type,
            `${consolidatedPrompt.pmc_field}_enhanced`,
            i + 1
          )
        ]);
        
        // Seleccionar mejor resultado de esta página
        const results = [];
        if (gptResult.status === 'fulfilled') results.push(gptResult.value);
        if (geminiResult.status === 'fulfilled') results.push(geminiResult.value);
        
        for (const result of results) {
          if (result.confidence > bestConfidence) {
            bestResult = result;
            bestConfidence = result.confidence;
          }
        }
        
      } catch (error) {
        this.logger.warn(`⚠️ Enhanced analysis failed on page ${i + 1}: ${error.message}`);
      }
    }
    
    return {
      answer: bestResult?.response || 'NOT_FOUND'.repeat(consolidatedPrompt.expected_fields.length).split('NOT_FOUND').join(';').slice(0, -1),
      confidence: bestConfidence
    };
  }

  /**
   * 🧩 ESTRATEGIA 2: Análisis por chunks de campos
   */
  private async performChunkedFieldAnalysis(
    consolidatedPrompt: any,
    images: Buffer[],
    extractedText: string
  ): Promise<{answer: string, confidence: number}> {
    
    const fieldNames = consolidatedPrompt.expected_fields;
    const chunkSize = Math.ceil(fieldNames.length / 3); // Dividir en 3 chunks
    const chunks = [];
    
    for (let i = 0; i < fieldNames.length; i += chunkSize) {
      chunks.push(fieldNames.slice(i, i + chunkSize));
    }
    
    this.logger.log(`🧩 Analyzing ${chunks.length} field chunks: ${chunks.map(c => c.length).join(', ')} fields each`);
    
    const chunkResults = [];
    
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      
      // Crear prompt específico para este chunk
      const chunkPrompt = `Focus ONLY on finding these ${chunk.length} specific fields:
${chunk.map((field, idx) => `${idx + 1}. ${field}`).join('\n')}

Return exactly ${chunk.length} values separated by semicolons, in the exact order listed above.
Use NOT_FOUND only if absolutely certain the information is not present.

Document text reference:
${extractedText.substring(0, 2000)}...`;
      
      try {
        // Analizar TODAS las páginas disponibles y quedarse con el mejor resultado
        let bestChunkResp = 'NOT_FOUND'.repeat(chunk.length).split('NOT_FOUND').join(';').slice(0, -1);
        let bestConf = 0;
        let bestPage = 1;

        const maxPages = Math.min(images.length, 6);
        for (let p = 0; p < maxPages; p++) {
          const imageBase64 = images[p].toString('base64');
          try {
            const res = await this.geminiService.analyzeWithVision(
              imageBase64,
              chunkPrompt,
              consolidatedPrompt.expected_type,
              `${consolidatedPrompt.pmc_field}_chunk${chunkIndex}`,
              p + 1
            );
            if ((res.confidence || 0) > bestConf) {
              bestConf = res.confidence || 0;
              bestChunkResp = res.response || bestChunkResp;
              bestPage = p + 1;
            }
          } catch (perPageErr) {
            this.logger.debug(`⚠️ Chunk ${chunkIndex + 1} page ${p + 1} failed: ${perPageErr.message}`);
            continue;
          }
        }

        chunkResults.push(bestChunkResp);
        this.logger.log(`🧩 Chunk ${chunkIndex + 1} best page ${bestPage} result: "${bestChunkResp}" (conf: ${bestConf})`);
        
      } catch (error) {
        this.logger.warn(`⚠️ Chunk ${chunkIndex + 1} analysis failed: ${error.message}`);
        chunkResults.push('NOT_FOUND'.repeat(chunk.length).split('NOT_FOUND').join(';').slice(0, -1));
      }
    }
    
    // Combinar resultados de chunks
    const combinedAnswer = chunkResults.join(';');
    
    return {
      answer: combinedAnswer,
      confidence: 0.75 // Confianza media para análisis por chunks
    };
  }

  /**
   * 🎯 Combina múltiples resultados con lógica inteligente
   */
  private combineMultipleResults(results: Array<{answer: string, confidence: number, source: string}>): {answer: string, confidence: number} {
    
    this.logger.log(`🎯 Combining ${results.length} results from different strategies`);
    
    // Separar todas las respuestas en arrays de valores
    const allValueArrays = results.map(r => ({
      values: r.answer.split(';'),
      confidence: r.confidence,
      source: r.source
    }));
    
    const fieldCount = allValueArrays[0]?.values.length || 0;
    const finalValues = [];
    
    // Para cada campo, seleccionar el mejor valor
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
      const fieldOptions = allValueArrays
        .map(arr => ({
          value: arr.values[fieldIndex] || 'NOT_FOUND',
          confidence: arr.confidence,
          source: arr.source
        }))
        .filter(option => option.value && option.value.trim() !== '');
      
      // Priorizar valores que NO sean NOT_FOUND
      const nonNotFound = fieldOptions.filter(opt => opt.value !== 'NOT_FOUND');
      
      if (nonNotFound.length > 0) {
        // Usar el valor con mayor confianza que no sea NOT_FOUND
        const bestNonNotFound = nonNotFound.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        finalValues.push(bestNonNotFound.value);
        
      } else {
        // Todos son NOT_FOUND, usar el de mayor confianza
        const bestNotFound = fieldOptions.reduce((best, current) => 
          current.confidence > best.confidence ? current : best,
          {value: 'NOT_FOUND', confidence: 0, source: 'fallback'}
        );
        finalValues.push(bestNotFound.value);
      }
    }
    
    const finalAnswer = finalValues.join(';');
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
    
    this.logger.log(`🎯 Final combined answer: "${finalAnswer}" (avg confidence: ${avgConfidence.toFixed(2)})`);
    
    return {
      answer: finalAnswer,
      confidence: Math.min(avgConfidence + 0.1, 0.95) // Bonus por combinación múltiple
    };
  }

  /**
   * 💾 NUEVA FUNCIÓN: Extraer y retener valores temporales del primer método
   */
  private extractTemporalValues(gptResponse: string, geminiResponse: string): Array<{index: number, value: string, confidence: number, source: string}> {
    const temporalValues = [];
    
    const gptValues = gptResponse.split(';');
    const geminiValues = geminiResponse.split(';');
    
    // Extraer todos los valores que NO sean NOT_FOUND
    for (let i = 0; i < Math.max(gptValues.length, geminiValues.length); i++) {
      const gptValue = gptValues[i]?.trim();
      const geminiValue = geminiValues[i]?.trim();
      
      // Priorizar valores reales sobre NOT_FOUND
      if (gptValue && gptValue !== 'NOT_FOUND') {
        temporalValues.push({
          index: i,
          value: gptValue,
          confidence: 0.7,
          source: 'gpt-temporal'
        });
      } else if (geminiValue && geminiValue !== 'NOT_FOUND') {
        temporalValues.push({
          index: i,
          value: geminiValue,
          confidence: 0.8,
          source: 'gemini-temporal'
        });
      }
    }
    
    this.logger.log(`💾 Extracted ${temporalValues.length} temporal values: ${temporalValues.map(v => `[${v.index}]=${v.value}`).join(', ')}`);
    return temporalValues;
  }

  /**
   * 🎯 NUEVA FUNCIÓN: Combina múltiples resultados con suma progresiva y retención temporal
   */
  private combineProgressiveResults(
    results: Array<{answer: string, confidence: number, source: string, priority: number}>,
    temporalValues: Array<{index: number, value: string, confidence: number, source: string}>,
    expectedFields: string[]
  ): {answer: string, confidence: number} {

    this.logger.log(`🎯 Progressive combining ${results.length} results + ${temporalValues.length} temporal values`);
    this.logger.log(`🔧 [DEPLOY-TEST] New algorithm active: confidence threshold logic enabled`);
    
    const fieldCount = expectedFields.length;
    const finalValues = new Array(fieldCount).fill('NOT_FOUND');
    const fieldConfidences = new Array(fieldCount).fill(0);
    
    // PASO 1: Aplicar valores temporales retenidos (prioridad máxima)
    temporalValues.forEach(temp => {
      if (temp.index < fieldCount) {
        finalValues[temp.index] = temp.value;
        fieldConfidences[temp.index] = temp.confidence + 0.2; // Bonus por retención temporal
        this.logger.log(`💾 Applied temporal value [${temp.index}]: ${temp.value}`);
      }
    });
    
    // PASO 2: Procesar resultados por orden de prioridad
    results.sort((a, b) => a.priority - b.priority);
    
    for (const result of results) {
      const values = result.answer.split(';');
      
      for (let i = 0; i < Math.min(values.length, fieldCount); i++) {
        const valueRaw = values[i];
        const value = valueRaw ? valueRaw.trim() : '';
        const fname = expectedFields[i] || '';
        const isBooleanHint = fname.toLowerCase().includes('sign') || fname.toLowerCase().endsWith('_match') || fname === 'mechanics_lien';

        if (!value) continue;

        if (isBooleanHint) {
          // Regla: YES siempre sobreescribe; NO solo si actual es NOT_FOUND
          if (value === 'YES') {
            const oldValue = finalValues[i];
            finalValues[i] = 'YES';
            fieldConfidences[i] = Math.max(fieldConfidences[i], result.confidence, 0.8);
            if (oldValue !== 'YES') {
              this.logger.log(`🔄 [BOOL] Field [${i} ${fname}] set to YES (source ${result.source}, conf ${result.confidence})`);
            }
          } else if (value === 'NO' && finalValues[i] === 'NOT_FOUND') {
            finalValues[i] = 'NO';
            fieldConfidences[i] = Math.max(fieldConfidences[i], result.confidence);
          }
          continue;
        }

        // No boolean: preferir reemplazar NOT_FOUND; si ambos válidos, usar mayor confianza
        if (value && (finalValues[i] === 'NOT_FOUND')) {
          const oldValue = finalValues[i];
          finalValues[i] = value;
          fieldConfidences[i] = result.confidence;
          if (oldValue !== value) {
            this.logger.log(`🔄 Field [${i}] updated: "${oldValue}" → "${value}" (${result.source}, conf: ${result.confidence})`);
          }
        } else if (value !== 'NOT_FOUND' && result.confidence > fieldConfidences[i]) {
          const oldValue = finalValues[i];
          const fieldName = expectedFields[i] || '';

          // ALGORITMO MEJORADO: Solo sobrescribir si la diferencia de confianza es significativa
          const confidenceDiff = result.confidence - fieldConfidences[i];
          const oldValueIsValid = oldValue && oldValue !== 'NOT_FOUND' && oldValue.length > 2;
          const minConfidenceDiff = oldValueIsValid ? 0.15 : 0.05; // Requiere mayor diferencia para valores válidos

          if (oldValueIsValid && confidenceDiff < minConfidenceDiff) {
            this.logger.warn(`🛡️ [STABILITY] Field [${i} ${fieldName}] KEPT: "${oldValue}" (conf diff ${confidenceDiff.toFixed(3)} < ${minConfidenceDiff})`);
            continue; // Skip overwrite if confidence improvement is minimal
          }

          // Log para cambios importantes
          if (oldValueIsValid) {
            this.logger.warn(`⚠️ [SIGNIFICANT] Field [${i} ${fieldName}] OVERWRITE: "${oldValue}" → "${value}" (conf diff: +${confidenceDiff.toFixed(3)})`);
          }

          finalValues[i] = value;
          fieldConfidences[i] = result.confidence;
          if (oldValue !== value) {
            this.logger.log(`🔄 Field [${i}] updated: "${oldValue}" → "${value}" (${result.source}, conf: ${result.confidence})`);
          }
        }
      }
    }
    
    // PASO 3: Calcular confianza final promedio ponderada
    const totalConfidence = fieldConfidences.reduce((sum, conf) => sum + conf, 0);
    const avgConfidence = Math.min(totalConfidence / fieldCount, 0.95);
    
    const finalAnswer = finalValues.join(';');
    const notFoundCount = finalValues.filter(v => v === 'NOT_FOUND').length;
    
    this.logger.log(`🎯 Progressive result: ${fieldCount - notFoundCount}/${fieldCount} fields filled (${((1 - notFoundCount/fieldCount) * 100).toFixed(1)}%)`);
    this.logger.log(`🎯 Final answer: "${finalAnswer}"`);
    
    return {
      answer: finalAnswer,
      confidence: Math.max(avgConfidence, 0.7) // Mínimo 0.7 para suma progresiva
    };
  }

  /**
   * 📊 Calcula tasa de NOT_FOUND
   */
  private calculateNotFoundRate(answer: string): number {
    const values = answer.split(';');
    const notFoundCount = values.filter(v => v.trim() === 'NOT_FOUND').length;
    return notFoundCount / values.length;
  }
}
