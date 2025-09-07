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

      // 🧪 HARDCODED TEST PARA MECHANICS_LIEN - ELIMINAR DESPUÉS
      if (consolidatedPrompt.pmc_field === 'lop_responses') {
        this.logger.log(`🧪🧪🧪 PRUEBA HARDCODEADA: Probando solo mechanics_lien field`);
        
        const simplePrompt = "Look at this document and determine if there is any language related to liens, mechanics liens, legal claims on property, lien rights, lien waivers, liens upon property, liens upon proceeds, insurance payments, mechanics liens, letters of protection, security interests, or encumbrances. Respond with YES if found or NO if not found.";
        
        try {
          // Test con GPT-4o Vision solo para mechanics_lien
          const testResult = await this.openaiService.invokeGPTVision({
            pmc_field: 'TEST_mechanics_lien',
            question: simplePrompt,
            expected_type: ResponseType.BOOLEAN
          }, images, extractedText, {
            useTargetedPages: false,
            enableEarlyExit: false,
            allowPartialAnalysis: false,
            maxPagesPerField: images.length,
            useGeminiPrimary: false
          });
          
          this.logger.log(`🧪 RESULTADO DE PRUEBA INDIVIDUAL: "${testResult.response}" (confianza: ${testResult.confidence})`);
          this.logger.log(`🧪 Si esto dice YES, entonces el problema es el prompt consolidado largo`);
          
        } catch (testError) {
          this.logger.error(`🧪 Error en prueba individual: ${testError.message}`);
        }
      }
      // 🧪 FIN DE PRUEBA HARDCODEADA

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
      const consensus = this.calculateConsensus(bestGptResult.response, bestGeminiResult.response);
      
      this.logger.log(`📊 DUAL VISION CONSENSUS: Agreement=${consensus.agreement}, Final="${consensus.finalAnswer}"`);
      this.logger.log(`   GPT-4o: "${bestGptResult.response}" (${bestGptResult.confidence})`);
      this.logger.log(`   Gemini: "${bestGeminiResult.response}" (${bestGeminiResult.confidence})`);
      
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
}