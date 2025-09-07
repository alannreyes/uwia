import { Injectable, Logger } from '@nestjs/common';
import { openaiConfig, processingConfig } from '../../../config/openai.config';
import { ResponseType } from '../entities/uw-evaluation.entity';
import { JudgeValidatorService } from './judge-validator.service';
import { RateLimiterService } from './rate-limiter.service';
// NUEVO: Servicios mejorados (inicialmente no se usan)
import { GeminiService } from './gemini.service';
import { EnhancedChunkingService } from './enhanced-chunking.service';
import { ProductionLogger } from '../../../common/utils/production-logger';

const { OpenAI } = require('openai');

export interface EvaluationResult {
  response: string;
  confidence: number;
  validation_response: string;
  validation_confidence: number;
  final_confidence: number;
  openai_metadata?: any;
}

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly prodLogger = new ProductionLogger(OpenAiService.name);
  private openai: any;
  private rateLimiter: RateLimiterService;
  
  // NUEVO: Servicios mejorados (inicialmente no se usan)
  private geminiService?: GeminiService;
  private enhancedChunking?: EnhancedChunkingService;

  constructor(private judgeValidator: JudgeValidatorService) {
    this.rateLimiter = new RateLimiterService();
    
    // NUEVO: Inicializar servicios mejorados (GPT-4o + Gemini)
    try {
      this.geminiService = new GeminiService();
      this.enhancedChunking = new EnhancedChunkingService();
      this.logger.log('🚀 Servicios mejorados inicializados (modo: dual GPT-4o + Gemini)');
    } catch (error) {
      this.logger.warn(`⚠️ No se pudieron inicializar servicios mejorados: ${error.message}`);
    }
    
    // Inicializar cliente OpenAI (existente)
    if (!openaiConfig.enabled) {
      this.logger.warn('OpenAI está deshabilitado');
      return;
    }
    
    if (!openaiConfig.apiKey) {
      throw new Error('OPENAI_API_KEY no configurada');
    }
    
    this.openai = new OpenAI({
      apiKey: openaiConfig.apiKey,
      timeout: openaiConfig.timeout,
      maxRetries: openaiConfig.maxRetries,
    });
  }

  async evaluateWithValidation(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string,
    pmcField?: string
  ): Promise<EvaluationResult> {
    try {
      // Verificar si OpenAI está habilitado
      if (!openaiConfig.enabled) {
        throw new Error('OpenAI está deshabilitado');
      }

      // Optimización: Usar chunking inteligente para documentos grandes
      const relevantText = this.extractRelevantChunks(documentText, prompt);

      // Verificar tamaño del texto optimizado
      if (relevantText.length > openaiConfig.maxTextLength) {
        this.logger.warn(`Texto excede el límite de ${openaiConfig.maxTextLength} caracteres`);
        if (openaiConfig.fallbackToLocal) {
          throw new Error('Texto muy largo, se requiere procesamiento local');
        }
        throw new Error(`El texto excede el límite máximo de ${openaiConfig.maxTextLength} caracteres`);
      }

      // Sistema complementario: GPT-4o + Gemini trabajando juntos
      if (this.geminiService && this.enhancedChunking) {
        this.logger.debug(`[${pmcField}] 🆕 Using GPT-4o + Gemini complementary validation system`);
        return await this.evaluateWithNewArchitecture(documentText, prompt, expectedType, additionalContext, pmcField);
      }
      
      // Fallback si Gemini no está disponible - usar solo GPT-4o
      this.logger.debug('📊 Using GPT-4o single model (Gemini not available)');
      const result = await this.evaluatePrompt(relevantText, prompt, expectedType, additionalContext, undefined, pmcField);
      
      return {
        response: result.response,
        confidence: result.confidence,
        validation_response: result.response,
        validation_confidence: result.confidence,
        final_confidence: result.confidence,
        openai_metadata: {
          primary_model: openaiConfig.model,
          validation_model: 'none',
          primary_tokens: result.tokens_used,
          validation_tokens: 0,
          system_mode: 'single_model_fallback'
        }
      };
    } catch (error) {
      this.logger.error(`Error en evaluación: ${error.message}`);
      throw error;
    }
  }

  private async evaluatePrompt(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string,
    modelOverride?: string,
    pmcField?: string
  ): Promise<{ response: string; confidence: number; tokens_used: number }> {
    const systemPrompt = this.buildSystemPrompt(expectedType, additionalContext, false, pmcField);
    const userPrompt = this.buildUserPrompt(documentText, prompt);
    const modelToUse = modelOverride || openaiConfig.model;

    // Usar rate limiter para todas las llamadas a OpenAI
    const completion = await this.rateLimiter.executeWithRateLimit(
      async () => {
        return await this.openai.chat.completions.create({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          // temperature: 1, // GPT-5: Only default value (1) supported - removed parameter
          max_completion_tokens: pmcField === 'policy_comprehensive_analysis' ? 2000 : openaiConfig.maxTokens,
          reasoning_effort: "medium", // GPT-5 specific: enhanced analysis depth
        });
      },
      `evaluate_${pmcField || 'field'}`,
      pmcField?.includes('sign') ? 'high' : 'normal' // Alta prioridad para campos de firma
    );

    const response = completion.choices[0].message.content.trim();
    const confidence = this.extractConfidence(response);
    const cleanResponse = this.cleanResponse(response, expectedType);

    // NUEVO: Logging de comparaciones para campos _match
    if (pmcField && pmcField.includes('_match')) {
      this.logComparisonDetails(pmcField, prompt, cleanResponse, confidence, documentText);
    }

    return {
      response: cleanResponse,
      confidence: confidence,
      tokens_used: completion.usage?.total_tokens || 0
    };
  }


  private buildSystemPrompt(expectedType: ResponseType, additionalContext?: string, isValidation = false, pmcField?: string): string {
    // Prompts optimizados para campos problemáticos
    const criticalFields = ['matching_insured_name', 'policy_comprehensive_analysis', 'lop_signed_by_client1'];
    const isCriticalField = pmcField && criticalFields.includes(pmcField);
    
    let basePrompt = isValidation 
      ? `Validate this analysis.\n`
      : `Analyze document precisely.\n`;
    
    // Instrucciones especiales para campos críticos que devuelven vacío
    if (isCriticalField) {
      basePrompt += `IMPORTANT: Search thoroughly. Extract ANY relevant info. Do NOT return empty.\n`;
    }
    
    // Instrucciones especiales para campos de POLICY.pdf para evitar NOT_FOUND
    if (pmcField && (pmcField.includes('policy_') || pmcField.includes('_policy'))) {
      basePrompt += `CRITICAL: For POLICY documents, search exhaustively. Use partial matches, inferences, and contextual clues. Avoid "not found" responses.\n`;
    }

    basePrompt += `FORMAT:\n`;

    // Formato especial para el campo 'state'
    if (pmcField === 'state') {
      basePrompt += `XX StateName (e.g., "FL Florida")\n[CONFIDENCE: 0.XX]`;
    } else {
      // Formatos normales para otros campos
      switch (expectedType) {
        case ResponseType.BOOLEAN:
          basePrompt += `YES/NO only\n[CONFIDENCE: 0.XX]`;
          break;
        case ResponseType.DATE:
          if (pmcField && (pmcField.includes('policy_') || pmcField.includes('_policy'))) {
            basePrompt += `MM-DD-YY format. Extract from any date format found.\n[CONFIDENCE: 0.XX]`;
          } else {
            basePrompt += `MM-DD-YY format (e.g., 07-22-25) or "not found"\n[CONFIDENCE: 0.XX]`;
          }
          break;
        case ResponseType.TEXT:
          // Formato especial para análisis comprensivo
          if (pmcField === 'policy_comprehensive_analysis') {
            basePrompt += `Comprehensive analysis (max 2000 chars). Consolidate all findings.\n[CONFIDENCE: 0.XX]`;
          } else {
            basePrompt += `Max 100 chars\n[CONFIDENCE: 0.XX]`;
          }
          break;
        case ResponseType.NUMBER:
          if (pmcField && (pmcField.includes('policy_') || pmcField.includes('_policy'))) {
            basePrompt += `Extract any numerical value found. Use context clues.\n[CONFIDENCE: 0.XX]`;
          } else {
            basePrompt += `Number only or "not found"\n[CONFIDENCE: 0.XX]`;
          }
          break;
        case ResponseType.JSON:
          basePrompt += `Valid JSON with "confidence": 0.XX`;
          break;
      }
    }

    if (additionalContext) {
      basePrompt += `\n\nADDITIONAL CONTEXT: ${additionalContext}`;
    }

    return basePrompt;
  }

  private buildUserPrompt(documentText: string, prompt: string): string {
    return `DOCUMENT:
${documentText}

QUESTION: ${prompt}

ANSWER:`;
  }


  private extractConfidence(response: string): number {
    const confidenceMatch = response.match(/\[CONFIDENCE:\s*([0-9.]+)\]/i) || 
                           response.match(/"confidence":\s*([0-9.]+)/i);
    
    if (confidenceMatch) {
      const confidence = parseFloat(confidenceMatch[1]);
      return Math.min(Math.max(confidence, 0), 1); // Clamp between 0 and 1
    }
    
    return 0.5; // Default confidence if not found
  }

  private cleanResponse(response: string, expectedType: ResponseType): string {
    // Remove confidence markers
    let cleanResponse = response.replace(/\[CONFIDENCE:\s*[0-9.]+\]/gi, '').trim();
    
    switch (expectedType) {
      case ResponseType.BOOLEAN:
        const boolMatch = cleanResponse.toUpperCase();
        if (boolMatch.includes('YES')) return 'YES';
        if (boolMatch.includes('NO')) return 'NO';
        return cleanResponse.toUpperCase();
      
      case ResponseType.DATE:
        // Buscar fecha en varios formatos y convertir a MM-DD-YY
        const datePatterns = [
          /\d{2}-\d{2}-\d{2}/, // MM-DD-YY
          /\d{2}-\d{2}-\d{4}/, // MM-DD-YYYY
          /\d{4}-\d{2}-\d{2}/, // YYYY-MM-DD
          /\d{2}\/\d{2}\/\d{2}/, // MM/DD/YY
          /\d{2}\/\d{2}\/\d{4}/ // MM/DD/YYYY
        ];
        
        let dateFound = null;
        for (const pattern of datePatterns) {
          const match = cleanResponse.match(pattern);
          if (match) {
            dateFound = match[0];
            break;
          }
        }
        
        if (dateFound) {
          // Convertir a MM-DD-YY si es necesario
          const parts = dateFound.split(/[-\/]/);
          if (parts.length === 3) {
            // Si el año tiene 4 dígitos, tomar solo los últimos 2
            if (parts[0].length === 4) {
              // YYYY-MM-DD -> MM-DD-YY
              return `${parts[1]}-${parts[2]}-${parts[0].slice(-2)}`;
            } else if (parts[2].length === 4) {
              // MM-DD-YYYY -> MM-DD-YY
              return `${parts[0]}-${parts[1]}-${parts[2].slice(-2)}`;
            }
            // Ya está en MM-DD-YY
            return dateFound.replace(/\//g, '-');
          }
        }
        
        return cleanResponse;
      
      case ResponseType.JSON:
        try {
          // Try to parse and re-stringify to ensure valid JSON
          const parsed = JSON.parse(cleanResponse);
          return JSON.stringify(parsed);
        } catch {
          return cleanResponse;
        }
      
      default:
        return cleanResponse;
    }
  }

  private calculateFinalConfidence(primaryConfidence: number, validationConfidence: number): number {
    // Si las respuestas son consistentes, usar el promedio
    // Si son diferentes, usar el menor de los dos para ser conservadores
    const average = (primaryConfidence + validationConfidence) / 2;
    const conservative = Math.min(primaryConfidence, validationConfidence);
    
    // Si la diferencia es pequeña, usar promedio; si es grande, ser conservador
    const difference = Math.abs(primaryConfidence - validationConfidence);
    
    if (difference <= 0.2) {
      return Math.round(average * 100) / 100;
    } else {
      return Math.round(conservative * 100) / 100;
    }
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = openaiConfig.maxRetries
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Si es error 429 (rate limit) o 503 (service unavailable), reintentar
        const isRetryableError = error?.status === 429 || 
                                error?.status === 503 || 
                                error?.code === 'rate_limit_exceeded' ||
                                error?.message?.includes('rate limit') ||
                                error?.message?.includes('Rate limit');
        
        if (!isRetryableError || attempt === maxRetries) {
          throw error;
        }
        
        // Calcular delay con exponential backoff
        const baseDelay = openaiConfig.retryDelay;
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 1000; // 0-1000ms de jitter
        const totalDelay = exponentialDelay + jitter;
        
        this.logger.warn(`Rate limit hit, retrying in ${Math.round(totalDelay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        
        await this.sleep(totalDelay);
      }
    }
    
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private extractRelevantChunks(documentText: string, prompt: string): string {
    const sizeMB = documentText.length / (1024 * 1024);
    
    // Para documentos ultra masivos (>100MB de texto), usar estrategia inteligente
    if (documentText.length > 100 * 1024 * 1024) {
      this.logger.warn(`🔥 DOCUMENTO ULTRA MASIVO: ${sizeMB.toFixed(2)}MB de texto - usando chunking avanzado`);
      return this.processUltraMassiveDocument(documentText, prompt);
    }
    
    // Para documentos muy grandes (>50K chars), usar chunking inteligente mejorado
    if (documentText.length > 50000) {
      this.logger.log(`📊 Documento grande: ${(documentText.length/1000).toFixed(0)}K chars - usando chunking inteligente`);
      return this.processLargeDocumentWithChunking(documentText, prompt);
    }
    
    // Si el documento es pequeño, retornarlo completo
    if (documentText.length <= 6000) { // Reducido de 15000
      return documentText;
    }

    // Dividir el documento en chunks más pequeños para mejor procesamiento
    const MAX_CHUNK_CHARACTERS = 8000; // Límite máximo por chunk
    const chunkSize = 5000; // Reducido de 8000
    const overlap = 300; // Reducido de 500 para menos repetición
    const chunks: string[] = [];
    
    for (let i = 0; i < documentText.length; i += chunkSize - overlap) {
      const chunk = documentText.slice(i, i + chunkSize);
      chunks.push(chunk);
    }

    // Palabras clave basadas en el tipo de pregunta
    const keywordMap = this.getRelevantKeywords(prompt.toLowerCase());
    
    // Scoring de chunks basado en relevancia
    const scoredChunks = chunks.map((chunk, index) => {
      const chunkLower = chunk.toLowerCase();
      let score = 0;
      
      // Puntuación por palabras clave
      keywordMap.forEach(keyword => {
        const matches = (chunkLower.match(new RegExp(keyword, 'g')) || []).length;
        score += matches * 10;
      });
      
      // Bonus por posición (primeros y últimos chunks suelen tener info importante)
      if (index === 0 || index === chunks.length - 1) {
        score += 5;
      }
      
      return { chunk, score, index };
    });

    // Ordenar por score y tomar los mejores chunks
    scoredChunks.sort((a, b) => b.score - a.score);
    
    // Tomar chunks hasta un máximo de 8,000 caracteres (reducido de 25,000)
    const MAX_TOTAL_CHARACTERS = 8000;
    let totalLength = 0;
    const selectedChunks: { chunk: string; index: number }[] = [];
    
    for (const item of scoredChunks) {
      if (totalLength + item.chunk.length <= MAX_TOTAL_CHARACTERS) {
        selectedChunks.push(item);
        totalLength += item.chunk.length;
      }
    }

    // Reordenar por índice original para mantener coherencia
    selectedChunks.sort((a, b) => a.index - b.index);
    
    // Si no hay chunks relevantes, tomar solo el primer chunk (máximo 8000 caracteres)
    if (selectedChunks.length === 0) {
      const firstChunk = documentText.substring(0, MAX_TOTAL_CHARACTERS);
      this.logger.warn('⚠️ No se encontraron chunks relevantes - usando primeros 8000 caracteres');
      return firstChunk + (documentText.length > MAX_TOTAL_CHARACTERS ? '\n\n...[RESTO TRUNCADO]' : '');
    }

    return selectedChunks.map(item => item.chunk).join('\n\n--- CHUNK SEPARATOR ---\n\n');
  }

  private getRelevantKeywords(prompt: string): string[] {
    const keywordSets = {
      // Información del asegurado/homeowner
      insured: ['insured', 'homeowner', 'policyholder', 'name', 'address', 'street', 'city', 'zip', 'owner'],
      
      // Información de la compañía de seguros
      company: ['insurance company', 'carrier', 'insurer', 'company', 'underwriter'],
      
      // Fechas y vigencia
      dates: ['date', 'effective', 'expiration', 'valid', 'from', 'to', 'period', 'term'],
      
      // Número de póliza
      policy: ['policy number', 'policy no', 'certificate', 'contract', 'agreement'],
      
      // Cobertura y servicios
      coverage: ['coverage', 'covered', 'service', 'benefit', 'protection', 'limit', 'deductible'],
      
      // Firmas y documentos
      signature: ['signature', 'signed', 'executed', 'authorized', 'witnessed'],
      
      // Mecánico lien
      lien: ['lien', 'mechanic', 'contractor', 'labor', 'material', 'construction']
    };

    let relevantKeywords: string[] = [];

    // Detectar tipo de pregunta y agregar palabras clave relevantes
    Object.entries(keywordSets).forEach(([category, keywords]) => {
      if (keywords.some(keyword => prompt.includes(keyword))) {
        relevantKeywords = [...relevantKeywords, ...keywords];
      }
    });

    // Agregar palabras específicas del prompt
    const promptWords = prompt.split(' ').filter(word => word.length > 3);
    relevantKeywords = [...relevantKeywords, ...promptWords];

    return [...new Set(relevantKeywords)]; // Eliminar duplicados
  }



  /**
   * Clasifica múltiples preguntas en batch para optimizar rendimiento
   */
  async classifyBatch(batchPrompt: string): Promise<string> {
    try {
      if (!openaiConfig.enabled) {
        throw new Error('OpenAI disabled');
      }

      const completion = await this.retryWithBackoff(async () => {
        return await this.openai.chat.completions.create({
          model: openaiConfig.model,
          messages: [
            { 
              role: 'system', 
              content: 'You are an expert at classifying document questions. Always respond with valid JSON only.' 
            },
            { role: 'user', content: batchPrompt }
          ],
          // temperature: 1, // GPT-5: Only default value (1) supported - removed parameter
          max_completion_tokens: 1000,
          response_format: { type: "json_object" }
        });
      });

      return completion.choices[0].message.content.trim();
      
    } catch (error) {
      this.logger.error(`Error in batch classification: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clasifica si una pregunta requiere análisis visual usando IA
   */
  async classifyVisualRequirement(
    pmcField: string,
    question: string
  ): Promise<{ requiresVisual: boolean; reason: string }> {
    try {
      if (!openaiConfig.enabled) {
        // Fallback conservador si OpenAI está deshabilitado
        return {
          requiresVisual: true,
          reason: 'OpenAI disabled - defaulting to visual analysis for safety'
        };
      }

      const classificationPrompt = `You are a document analysis expert. Analyze if this question requires visual inspection of the document.

Field name: ${pmcField}
Question: ${question}

Visual analysis IS REQUIRED for:
- Signatures, initials, or any handwritten elements
- Checkboxes, stamps, seals, or physical marks
- Document layout, formatting, or visual structure
- Logos, images, or graphical elements
- Anything that cannot be extracted from pure text

Visual analysis is NOT required for:
- Text values (names, addresses, numbers)
- Dates that are typed/printed
- Standard form field values
- Information that can be extracted via OCR

Respond in JSON format:
{
  "requires_visual": true/false,
  "reason": "brief explanation",
  "confidence": 0.0-1.0
}`;

      const completion = await this.retryWithBackoff(async () => {
        return await this.openai.chat.completions.create({
          model: openaiConfig.model, // Usar modelo configurado
          messages: [
            { 
              role: 'system', 
              content: 'You are an expert at determining if document questions require visual analysis. Respond only with valid JSON.' 
            },
            { role: 'user', content: classificationPrompt }
          ],
          // temperature: 1, // GPT-5: Only default value (1) supported - removed parameter // Baja temperatura para respuestas consistentes
          max_completion_tokens: 150,
          response_format: { type: "json_object" }
        });
      });

      const response = completion.choices[0].message.content.trim();
      const result = JSON.parse(response);
      
      this.logger.log(`📊 Visual classification for ${pmcField}: ${result.requires_visual} (${result.reason})`);
      
      return {
        requiresVisual: result.requires_visual || false,
        reason: result.reason || 'Classification completed'
      };
      
    } catch (error) {
      this.logger.error(`Error in visual classification: ${error.message}`);
      // En caso de error, ser conservador y usar análisis visual
      return {
        requiresVisual: true,
        reason: `Classification error - defaulting to visual: ${error.message}`
      };
    }
  }

  /**
   * Evalúa usando GPT-4 Vision para preguntas que requieren análisis visual
   */
  async evaluateWithVision(
    imageBase64: string,
    prompt: string,
    expectedType: ResponseType,
    pmcField?: string,
    pageNumber: number = 1
  ): Promise<EvaluationResult> {
    try {
      this.logger.log(`[${pmcField}] 🎯 Vision page ${pageNumber}`);
      
      if (!openaiConfig.enabled) {
        throw new Error('OpenAI está deshabilitado');
      }

      // Construir prompt específico para análisis visual
      const visionPrompt = this.buildVisionPrompt(prompt, expectedType, pmcField);
      
      // Usar rate limiter con alta prioridad para Vision API
      const completion = await this.rateLimiter.executeWithRateLimit(
        async () => {
          return await this.openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{
              role: "user",
              content: [
                {
                  type: "text",
                  text: visionPrompt
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${imageBase64}`,
                    detail: "high" // Alta resolución para detectar firmas
                  }
                }
              ]
            }],
            max_tokens: 250, // GPT-4o compatible
            temperature: 0.3 // GPT-4o optimized for precise vision tasks
          });
        },
        `vision_${pmcField || 'field'}_page${pageNumber}`,
        'high' // Alta prioridad para Vision API
      );

      const response = completion.choices[0].message.content.trim();
      const confidence = this.extractConfidence(response);
      const cleanResponse = this.cleanResponse(response, expectedType);

      // Ahora también usamos Gemini Vision para dual validation
      let geminiVisionResult = null;
      let finalResponse = cleanResponse;
      let finalConfidence = confidence;
      
      try {
        // Intentar dual validation con Gemini Vision si está disponible
        if (this.geminiService && this.geminiService.isAvailable()) {
          this.logger.log(`👁️ Ejecutando Gemini Vision para dual validation de ${pmcField}`);
          
          geminiVisionResult = await this.geminiService.analyzeWithVision(
            imageBase64,
            prompt,
            expectedType,
            pmcField,
            pageNumber
          );
          
          this.logger.log(`👁️ === GPT-4o VISION === "${cleanResponse}" (confidence: ${confidence}) ===`);
          this.prodLogger.visionApiLog('unknown', pmcField, 0, 'Gemini Vision', geminiVisionResult.response);
          
          // Normalizar respuestas para comparación (especialmente fechas)
          const normalizedGpt = this.normalizeForComparison(cleanResponse, expectedType);
          const normalizedGemini = this.normalizeForComparison(geminiVisionResult.response, expectedType);
          
          // Calcular consenso con valores normalizados
          const agreement = this.calculateNewAgreement(normalizedGpt, normalizedGemini);
          if (agreement < 0.7) {
            this.logger.warn(`[${pmcField}] ⚠️ Low visual consensus: ${(agreement * 100).toFixed(1)}%`);
          }
          
          // SIEMPRE usar el modelo con mayor confianza, independientemente del consenso
          if (geminiVisionResult.confidence > confidence) {
            // FIXED: Limpiar respuesta de Gemini para asegurar formato MM-DD-YY
            finalResponse = this.cleanResponse(geminiVisionResult.response, expectedType);
            finalConfidence = geminiVisionResult.confidence;
            this.logger.log(`✅ Usando Gemini Vision (confianza: ${geminiVisionResult.confidence} vs GPT-4o: ${confidence})`);
          } else if (confidence > geminiVisionResult.confidence) {
            // GPT-4o tiene mayor confianza (raro pero posible)
            this.logger.log(`✅ Usando GPT-4o Vision (confianza: ${confidence} vs Gemini: ${geminiVisionResult.confidence})`);
          } else {
            // Misma confianza, preferir el que tenga respuesta más específica
            if (geminiVisionResult.response !== 'NOT_FOUND' && cleanResponse === 'NOT_FOUND') {
              // FIXED: Limpiar respuesta de Gemini para asegurar formato MM-DD-YY
              finalResponse = this.cleanResponse(geminiVisionResult.response, expectedType);
              finalConfidence = geminiVisionResult.confidence;
              this.logger.log(`✅ Usando Gemini Vision (tiene respuesta específica)`);
            } else {
              this.logger.log(`✅ Usando GPT-4o Vision (confianza igual, es primario)`);
            }
          }
          
          // Log de advertencia solo si hay bajo consenso
          if (agreement < 0.8) {
            this.prodLogger.warning('unknown', pmcField, `Low visual consensus (${(agreement * 100).toFixed(1)}%) - Using ${finalResponse === geminiVisionResult.response ? 'Gemini' : 'GPT-4o'}`);
          }
        }
      } catch (geminiError) {
        this.logger.warn(`⚠️ Gemini Vision no disponible o falló: ${geminiError.message}`);
        // Continuar solo con GPT-4o Vision
      }
      
      return {
        response: finalResponse,
        confidence: finalConfidence,
        validation_response: geminiVisionResult?.response || cleanResponse,
        validation_confidence: geminiVisionResult?.confidence || confidence,
        final_confidence: finalConfidence,
        openai_metadata: {
          primary_model: 'gpt-4o-vision',
          validation_model: geminiVisionResult ? 'gemini-vision' : 'none',
          primary_tokens: completion.usage?.total_tokens || 0,
          validation_tokens: geminiVisionResult?.tokensUsed || 0,
          visual_analysis: true,
          page_analyzed: pageNumber
        }
      };

    } catch (error) {
      this.logger.error(`Error en evaluación con Vision:`, error);
      
      // FALLBACK: Si Vision API falla por rate limiting/circuit breaker, intentar análisis de texto
      const isRateLimitError = error.message.includes('Rate limiter') || 
                              error.message.includes('Circuit breaker') ||
                              error.message.includes('queue is full') ||
                              error.message.includes('timeout');
      
      if (isRateLimitError && pmcField?.toLowerCase().includes('sign')) {
        this.prodLogger.warning('unknown', pmcField, 'Vision API failed for signature field - attempting text analysis fallback');
        
        // Usar análisis de texto con prompt específico para firmas
        const fallbackPrompt = `FALLBACK SIGNATURE ANALYSIS - Vision API unavailable.
        
Based on the document structure and text patterns, ${prompt}

IMPORTANT: This is text-only analysis. Look for:
- Text patterns indicating signature areas (e.g., "Signature:", "Signed by:")
- Date patterns near signature sections
- Name patterns in signature contexts
- Form field indicators

If you cannot determine from text alone, respond "NO" with confidence 0.3 to indicate uncertainty.`;

        try {
          return await this.evaluateWithValidation(
            'FALLBACK MODE - LIMITED TEXT ANALYSIS',
            fallbackPrompt,
            expectedType,
            'Text-only fallback due to Vision API unavailability',
            pmcField
          );
        } catch (fallbackError) {
          this.logger.error(`Fallback also failed for ${pmcField}:`, fallbackError);
          // Retornar respuesta por defecto con baja confianza
          return {
            response: 'NO',
            confidence: 0.3,
            validation_response: 'NO',
            validation_confidence: 0.3,
            final_confidence: 0.3,
            openai_metadata: {
              primary_model: 'fallback',
              validation_model: 'none',
              primary_tokens: 0,
              validation_tokens: 0,
              error: 'Both Vision API and fallback failed',
              fallback_reason: error.message
            }
          };
        }
      }
      
      throw error;
    }
  }

  private buildVisionPrompt(prompt: string, expectedType: ResponseType, pmcField?: string): string {
    // GPT-5 optimized response instructions
    const typeInstructions = {
      boolean: '<output_format>Answer with ONLY "YES" or "NO".</output_format>',
      date: '<output_format>Answer with ONLY the date in MM-DD-YY format (e.g., 07-22-25).</output_format>',
      text: '<output_format>Provide a brief, specific textual answer.</output_format>',
      number: '<output_format>Answer with ONLY the numeric value (no units or formatting).</output_format>',
      json: '<output_format>Provide a valid JSON object.</output_format>'
    };

    const lowerField = (pmcField || '').toLowerCase();
    const isSignatureField = lowerField.includes('sign');

    if (isSignatureField) {
      // GPT-5 optimized signature detection prompt
      return `<task>
You are analyzing a document image to detect signatures or signing evidence using GPT-5's advanced visual capabilities.
</task>

<analysis_target>
${prompt}
</analysis_target>

<visual_search_criteria>
Look systematically for:
• Handwritten signatures (cursive, printed, stylized)
• Names written on designated signature lines
• "X" marks or signing indicators
• Printed names in signature areas
• Dates associated with signature sections
• Any marks indicating authorization or acknowledgment
• Initials or abbreviated signatures
</visual_search_criteria>

<reasoning_process>
1. SCAN: Examine entire document methodically
2. IDENTIFY: Locate all signature areas and lines
3. ANALYZE: Check each area for any form of marking
4. EVALUATE: Determine if markings constitute signing evidence
5. CONCLUDE: Make definitive YES/NO determination
</reasoning_process>

<decision_criteria>
• Answer "YES" if ANY signature evidence is detected
• Answer "NO" only if signature areas are completely unmarked
• When uncertain, examine image more carefully before deciding
• Consider both obvious and subtle signing indicators
</decision_criteria>

${typeInstructions[expectedType] || ''}`;
    } else {
      // GPT-5 optimized general visual analysis prompt
      const visualContext = this.getVisualAnalysisContext(lowerField);

      return `<task>
Analyze this document image using GPT-5's advanced visual processing to extract specific information.
</task>

<analysis_target>
${prompt}
</analysis_target>

<visual_analysis_approach>
${visualContext}
1. EXAMINE: Scan document systematically for relevant information
2. LOCATE: Find specific data points or visual elements
3. EXTRACT: Pull exact information matching the request
4. VALIDATE: Cross-check findings for accuracy
5. FORMAT: Present answer in specified format
</visual_analysis_approach>

<quality_requirements>
• Prioritize accuracy over speed
• Use exact text when available
• Maintain high confidence standards
• Clearly indicate if information is not found
</quality_requirements>

${typeInstructions[expectedType] || ''}

Important: Base your answer ONLY on what you can visually see in the image. If you cannot clearly determine the answer from the visual evidence, respond with "NO" for boolean questions or "NOT FOUND" for other types.`;
    }
  }

  /**
   * Provides context-specific visual analysis guidance for GPT-5
   */
  private getVisualAnalysisContext(fieldLower: string): string {
    if (fieldLower.includes('date')) {
      return `<visual_context>Date Analysis: Look for numerical date patterns, calendar references, or date stamps.</visual_context>`;
    }
    
    if (fieldLower.includes('stamp') || fieldLower.includes('seal')) {
      return `<visual_context>Stamp/Seal Analysis: Look for circular stamps, rectangular seals, embossed marks, or official insignia.</visual_context>`;
    }
    
    if (fieldLower.includes('check') || fieldLower.includes('mark') || fieldLower.includes('box')) {
      return `<visual_context>Checkbox Analysis: Look for checkmarks, X marks, filled boxes, or selection indicators.</visual_context>`;
    }
    
    if (fieldLower.includes('handwrit') || fieldLower.includes('filled')) {
      return `<visual_context>Handwriting Analysis: Look for handwritten text, filled form fields, or manual annotations.</visual_context>`;
    }
    
    if (fieldLower.includes('address') || fieldLower.includes('street') || fieldLower.includes('city')) {
      return `<visual_context>Address Analysis: Look for address blocks, street numbers, city/state information in forms.</visual_context>`;
    }
    
    if (fieldLower.includes('amount') || fieldLower.includes('money') || fieldLower.includes('cost')) {
      return `<visual_context>Amount Analysis: Look for dollar signs, numerical values, cost tables, or financial data.</visual_context>`;
    }
    
    return `<visual_context>General Analysis: Examine all visible text, forms, and document elements systematically.</visual_context>`;
  }

  private analyzeConsensus(
    primary: { response: string; confidence: number },
    validation: { response: string; confidence: number },
    expectedType: ResponseType
  ): { finalResponse: string; finalConfidence: number; agreement: boolean; reason: string } {
    
    // Normalizar respuestas para comparación
    const normalizedPrimary = this.normalizeResponse(primary.response, expectedType);
    const normalizedValidation = this.normalizeResponse(validation.response, expectedType);
    
    const agreement = normalizedPrimary === normalizedValidation;
    
    if (agreement) {
      // Ambos modelos están de acuerdo - alta confianza
      const avgConfidence = (primary.confidence + validation.confidence) / 2;
      return {
        finalResponse: primary.response,
        finalConfidence: Math.min(0.98, avgConfidence + 0.1), // Bonus por consensus
        agreement: true,
        reason: 'Both models agree'
      };
    } else {
      // Discrepancia - usar el modelo más confiable (premium por defecto)
      const useValidation = validation.confidence > primary.confidence;
      return {
        finalResponse: useValidation ? validation.response : primary.response,
        finalConfidence: Math.max(primary.confidence, validation.confidence) * 0.85, // Penalty por discrepancia
        agreement: false,
        reason: `Disagreement - used ${useValidation ? 'validation' : 'primary'} model (higher confidence)`
      };
    }
  }

  private normalizeResponse(response: string, expectedType: ResponseType): string {
    switch (expectedType) {
      case ResponseType.BOOLEAN:
        return response.toUpperCase().includes('YES') ? 'YES' : 'NO';
      case ResponseType.DATE:
        // Buscar fecha en varios formatos y convertir a MM-DD-YY
        const datePatterns = [
          /\d{2}-\d{2}-\d{2}/, // MM-DD-YY
          /\d{2}-\d{2}-\d{4}/, // MM-DD-YYYY  
          /\d{4}-\d{2}-\d{2}/, // YYYY-MM-DD
          /\d{2}\/\d{2}\/\d{2}/, // MM/DD/YY
          /\d{2}\/\d{2}\/\d{4}/ // MM/DD/YYYY
        ];
        
        let dateFound = null;
        for (const pattern of datePatterns) {
          const match = response.match(pattern);
          if (match) {
            dateFound = match[0];
            break;
          }
        }
        
        if (dateFound) {
          // Convertir a MM-DD-YY si es necesario
          const parts = dateFound.split(/[-\/]/);
          if (parts.length === 3) {
            // Si el año tiene 4 dígitos, tomar solo los últimos 2
            if (parts[0].length === 4) {
              // YYYY-MM-DD -> MM-DD-YY
              return `${parts[1]}-${parts[2]}-${parts[0].slice(-2)}`;
            } else if (parts[2].length === 4) {
              // MM-DD-YYYY -> MM-DD-YY
              return `${parts[0]}-${parts[1]}-${parts[2].slice(-2)}`;
            }
            // Ya está en MM-DD-YY
            return dateFound.replace(/\//g, '-');
          }
        }
        
        const responseStr = typeof response === 'string' 
          ? response 
          : (response as any)?.response || JSON.stringify(response);
        return responseStr.toLowerCase();
      default:
        const responseStr2 = typeof response === 'string' 
          ? response 
          : (response as any)?.response || JSON.stringify(response);
        return responseStr2.toLowerCase().trim();
    }
  }

  /**
   * NUEVO: Método para loggear detalles de comparaciones
   */
  private logComparisonDetails(
    pmcField: string,
    prompt: string,
    result: string,
    confidence: number,
    documentText: string
  ): void {
    try {
      // Extraer el valor esperado del prompt
      const expectedMatch = prompt.match(/Compare.*?with\s+([^\.]+)/i) || 
                           prompt.match(/compare.*?found.*?with\s+([^\.]+)/i);
      const expectedValue = expectedMatch ? expectedMatch[1].trim() : 'unknown';
      
      // Extraer el valor encontrado del documento (buscar en los últimos 500 caracteres del prompt)
      const relevantText = documentText.substring(0, 500);
      let foundValue = 'NOT_EXTRACTED';
      
      // Intentar extraer el valor según el tipo de campo
      if (pmcField.includes('street')) {
        const streetMatch = relevantText.match(/([0-9]+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd))/i);
        foundValue = streetMatch ? streetMatch[1].trim() : 'NOT_FOUND';
      } else if (pmcField.includes('zip')) {
        const zipMatch = relevantText.match(/\b(\d{5})\b/);
        foundValue = zipMatch ? zipMatch[1] : 'NOT_FOUND';
      } else if (pmcField.includes('city')) {
        // Buscar entre el patrón de dirección típico
        const cityMatch = relevantText.match(/,\s*([A-Za-z\s]+),\s*[A-Z]{2}/);
        foundValue = cityMatch ? cityMatch[1].trim() : 'NOT_FOUND';
      } else if (pmcField.includes('policy')) {
        const policyMatch = relevantText.match(/policy[:\s#]*([A-Z0-9\-]+)/i);
        foundValue = policyMatch ? policyMatch[1] : 'NOT_FOUND';
      } else if (pmcField.includes('claim')) {
        const claimMatch = relevantText.match(/claim[:\s#]*([A-Z0-9\-]+)/i);
        foundValue = claimMatch ? claimMatch[1] : 'NOT_FOUND';
      } else if (pmcField.includes('date')) {
        const dateMatch = relevantText.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);
        foundValue = dateMatch ? dateMatch[0] : 'NOT_FOUND';
      }
      
      // Logging con formato visual
      this.logger.log(`🔍 Comparación para ${pmcField}:`);
      this.logger.log(`   📄 Valor encontrado: "${foundValue}"`);
      this.logger.log(`   🎯 Valor esperado: "${expectedValue}"`);
      this.logger.log(`   ✅ Resultado: ${result} (${(confidence * 100).toFixed(0)}%)`);
      
    } catch (error) {
      this.logger.debug(`Error extrayendo valores para comparación: ${error.message}`);
    }
  }

  /**
   * @param documentText Documento completo sin chunking
   * @param prompt Pregunta a evaluar
   * @param expectedType Tipo de respuesta esperada
   * @param additionalContext Contexto adicional opcional
   * @param pmcField Campo PMC para logging
   */

  /**
   * @param chunkedDocument Documento con chunking para GPT
   * @param prompt Pregunta a evaluar
   * @param expectedType Tipo de respuesta esperada
   * @param additionalContext Contexto adicional
   * @param pmcField Campo PMC
   */

  /**
   * @param gptResult Resultado de GPT-4o
   * @param originalPrompt Pregunta original
   * @param expectedType Tipo esperado
   * @param documentSnippet Fragmento del documento para contexto
   * @param pmcField Campo PMC
   */

  /**
   * Calcula el nivel de acuerdo entre dos respuestas
   * @param response1 Primera respuesta
   * @param response2 Segunda respuesta
   * @param expectedType Tipo de respuesta esperada
   */
  private calculateAgreement(response1: string, response2: string, expectedType: ResponseType): number {
    // Normalizar respuestas para comparación
    const responseStr1 = typeof response1 === 'string' 
      ? response1 
      : (response1 as any)?.response || JSON.stringify(response1);
    const responseStr2 = typeof response2 === 'string' 
      ? response2 
      : (response2 as any)?.response || JSON.stringify(response2);
    const norm1 = responseStr1.toLowerCase().trim();
    const norm2 = responseStr2.toLowerCase().trim();

    // Acuerdo perfecto
    if (norm1 === norm2) return 1.0;

    // Para respuestas booleanas
    if (expectedType === ResponseType.BOOLEAN) {
      const isYes1 = norm1.includes('yes') || norm1.includes('sí') || norm1 === 'true';
      const isYes2 = norm2.includes('yes') || norm2.includes('sí') || norm2 === 'true';
      return isYes1 === isYes2 ? 0.9 : 0.1;
    }

    // Para fechas
    if (expectedType === ResponseType.DATE) {
      // Extraer componentes de fecha y comparar
      const date1 = this.extractDateComponents(norm1);
      const date2 = this.extractDateComponents(norm2);
      
      if (date1 && date2) {
        let agreement = 0;
        if (date1.year === date2.year) agreement += 0.4;
        if (date1.month === date2.month) agreement += 0.3;
        if (date1.day === date2.day) agreement += 0.3;
        return agreement;
      }
    }

    // Para números
    if (expectedType === ResponseType.NUMBER) {
      const num1 = parseFloat(norm1.replace(/[^0-9.-]/g, ''));
      const num2 = parseFloat(norm2.replace(/[^0-9.-]/g, ''));
      
      if (!isNaN(num1) && !isNaN(num2)) {
        const diff = Math.abs(num1 - num2);
        const avg = (num1 + num2) / 2;
        if (avg === 0) return num1 === num2 ? 1.0 : 0.0;
        const percentDiff = diff / avg;
        return Math.max(0, 1 - percentDiff);
      }
    }

    // Para texto: usar similitud de Jaccard simplificada
    const words1 = new Set(norm1.split(/\s+/));
    const words2 = new Set(norm2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * Extrae componentes de fecha de un string
   * @param dateStr String con fecha
   */
  private extractDateComponents(dateStr: string): { year?: string; month?: string; day?: string } | null {
    // Intentar varios formatos de fecha
    const patterns = [
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,  // MM/DD/YYYY o DD/MM/YYYY
      /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,     // YYYY/MM/DD
      /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,             // Month DD, YYYY
      /(\d{1,2})\s+(\w+)\s+(\d{4})/                // DD Month YYYY
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern);
      if (match) {
        return {
          year: match[3] || match[1],
          month: match[1] || match[2],
          day: match[2] || match[1]
        };
      }
    }

    return null;
  }

  /**
   */

  /**
   */

  /**
   */

  // ===== NUEVO SISTEMA DE MIGRACIÓN =====
  
  /**
   * Evalúa usando la nueva arquitectura: GPT-5 + Gemini 2.5 Pro + Enhanced Chunking
   * SOLO se ejecuta si MIGRATION_MODE está activado
   */
  private async evaluateWithNewArchitecture(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string,
    pmcField?: string
  ): Promise<EvaluationResult> {
    const startTime = Date.now();
    
    try {
      
      // 1. Enhanced Chunking para documentos grandes
      let processedContent = documentText;
      let chunkMetadata = null;
      
      // Si el documento es muy grande, usar enhanced chunking
      if (documentText.length > 400 * 1024) { // >400KB (aproximadamente 100K tokens)
        
        const chunkResult = await this.enhancedChunking!.processDocument(
          documentText,
          pmcField || 'unknown',
          { id: pmcField || 'unknown', size: documentText.length, type: 'pdf' }
        );
        
        this.logger.debug(`📊 Chunking: ${chunkResult.totalChunks} chunks, estrategia: ${chunkResult.strategy}`);
        
        // Para esta implementación inicial, tomar solo los chunks más importantes
        const topChunks = chunkResult.chunks
          .filter(c => c.priority === 'critical' || c.priority === 'high')
          .slice(0, 3); // Top 3 chunks más importantes
        
        processedContent = topChunks.map(c => c.content).join('\n\n--- SECTION ---\n\n');
        chunkMetadata = {
          totalChunks: chunkResult.totalChunks,
          selectedChunks: topChunks.length,
          strategy: chunkResult.strategy,
          recommendedModel: chunkResult.recommendedModel
        };
        
        this.logger.debug(`✂️ Contenido reducido de ${documentText.length} a ${processedContent.length} chars`);
      }
      
      // 2. Evaluación dual: GPT-5 + Gemini
      
      const [gpt5Result, geminiResult] = await Promise.allSettled([
        this.evaluateWithGPT5(processedContent, prompt, expectedType, additionalContext),
        this.geminiService!.evaluateDocument(processedContent, prompt, expectedType, additionalContext, pmcField)
      ]);
      
      // 3. Procesar resultados
      let primaryResult, secondaryResult;
      
      if (gpt5Result.status === 'fulfilled') {
        primaryResult = gpt5Result.value;
        this.prodLogger.visionApiLog('unknown', 'unknown', 0, 'GPT-5', primaryResult.response);
      } else {
        this.logger.error(`🚨 === GPT-5 FALLO === ${gpt5Result.reason?.message} ===`);
      }
      
      if (geminiResult.status === 'fulfilled') {
        secondaryResult = geminiResult.value;
        // FIXED: Limpiar respuesta de Gemini para asegurar formato MM-DD-YY
        if (expectedType === ResponseType.DATE && secondaryResult.response) {
          secondaryResult.response = this.cleanResponse(secondaryResult.response, ResponseType.DATE);
        }
        this.prodLogger.visionApiLog('unknown', 'unknown', 0, 'Gemini', secondaryResult.response);
      } else {
        // Check if Gemini is intentionally disabled vs. actual error
        const errorMsg = geminiResult.reason?.message || '';
        const isIntentionallyDisabled = errorMsg.includes('no está disponible') || errorMsg.includes('está deshabilitado');
        
        if (isIntentionallyDisabled) {
          this.logger.log(`🔕 === GEMINI DESHABILITADO === ${errorMsg} ===`);
        } else {
          this.logger.error(`🚨 === GEMINI FALLO === ${errorMsg} ===`);
        }
      }
      
      // 4. Análisis de consenso
      if (primaryResult && secondaryResult) {
        const agreement = this.calculateNewAgreement(primaryResult.response, secondaryResult.response);
        if (agreement < 0.7) {
          this.logger.warn(`[${pmcField}] ⚠️ Low consensus: ${(agreement * 100).toFixed(1)}%`);
          this.logger.debug(`[${pmcField}] ⚖️ Invoking judge for low agreement`);
        }
        
        if (agreement >= 0.8) {
          // Alto consenso - usar resultado con mayor confianza
          const bestResult = primaryResult.confidence > secondaryResult.confidence ? primaryResult : secondaryResult;
          const avgConfidence = (primaryResult.confidence + secondaryResult.confidence) / 2;
          
          return {
            response: bestResult.response,
            confidence: primaryResult.confidence,
            validation_response: secondaryResult.response,
            validation_confidence: secondaryResult.confidence,
            final_confidence: Math.min(0.99, avgConfidence + 0.1), // Bonus por consenso
            openai_metadata: {
              architecture: 'new',
              primary_model: 'gpt-5',
              secondary_model: 'gemini-2.5-pro',
              agreement_level: agreement,
              chunking_applied: !!chunkMetadata,
              chunk_metadata: chunkMetadata,
              processing_time: Date.now() - startTime,
              consensus: true
            }
          };
        } else {
          // Bajo consenso - invocar juez GPT-5
          
          const judgeResult = await this.invokeGPT5Judge(
            processedContent,
            prompt,
            primaryResult,
            secondaryResult,
            expectedType,
            pmcField
          );
          
          return {
            response: judgeResult.finalAnswer,
            confidence: judgeResult.confidence,
            validation_response: judgeResult.reasoning,
            validation_confidence: judgeResult.confidence,
            final_confidence: judgeResult.confidence,
            openai_metadata: {
              architecture: 'new',
              primary_model: 'gpt-5',
              secondary_model: 'gemini-2.5-pro',
              arbitrator_model: 'gpt-5',
              agreement_level: agreement,
              chunking_applied: !!chunkMetadata,
              chunk_metadata: chunkMetadata,
              processing_time: Date.now() - startTime,
              consensus: false,
              judge_decision: judgeResult.selectedModel
            }
          };
        }
      }
      
      // 5. Fallback si solo uno funciona
      const workingResult = primaryResult || secondaryResult;
      if (workingResult) {
        const workingModel = primaryResult ? 'GPT-5' : 'Gemini';
        const failedModel = primaryResult ? 'Gemini' : 'GPT-5';
        this.logger.log(`🔄 Usando modo single-model: ${workingModel} (${failedModel} no disponible)`);
        
        return {
          response: workingResult.response,
          confidence: workingResult.confidence,
          validation_response: workingResult.response,
          validation_confidence: workingResult.confidence,
          final_confidence: Math.max(0.5, workingResult.confidence - 0.1), // Penalizar falta de validación
          openai_metadata: {
            architecture: 'new',
            fallback_used: true,
            working_model: primaryResult ? 'gpt-5' : 'gemini-2.5-pro',
            chunking_applied: !!chunkMetadata,
            chunk_metadata: chunkMetadata,
            processing_time: Date.now() - startTime
          }
        };
      }
      
      // 6. Fallback total al sistema anterior
      this.logger.error('❌ Ambos modelos nuevos fallaron, usando sistema anterior');
      
      if (process.env.MIGRATION_FALLBACK !== 'false') {
        this.logger.log('🔄 Fallback al sistema anterior activado');
        
        // Llamar recursivamente pero desactivando migración temporalmente
        const originalMode = process.env.MIGRATION_MODE;
        process.env.MIGRATION_MODE = 'off';
        
        try {
          const fallbackResult = await this.evaluateWithValidation(
            documentText, prompt, expectedType, additionalContext, pmcField
          );
          
          return {
            ...fallbackResult,
            openai_metadata: {
              ...fallbackResult.openai_metadata,
              fallback_to_old_system: true,
              original_architecture_failed: true
            }
          };
        } finally {
          process.env.MIGRATION_MODE = originalMode;
        }
      }
      
      throw new Error('Todos los modelos fallaron y fallback está deshabilitado');
      
    } catch (error) {
      this.logger.error(`❌ Error en nueva arquitectura: ${error.message}`);
      
      // Fallback de emergencia
      if (process.env.MIGRATION_FALLBACK !== 'false') {
        this.logger.warn('🚨 Fallback de emergencia al sistema anterior');
        
        const originalMode = process.env.MIGRATION_MODE;
        process.env.MIGRATION_MODE = 'off';
        
        try {
          return await this.evaluateWithValidation(
            documentText, prompt, expectedType, additionalContext, pmcField
          );
        } finally {
          process.env.MIGRATION_MODE = originalMode;
        }
      }
      
      throw error;
    }
  }

  /**
   * Evalúa usando GPT-5 con fallback al método legacy si falla
   */
  private async evaluateWithGPT5(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string
  ): Promise<any> {
    const systemPrompt = this.buildGPT5SystemPrompt(expectedType);
    const fullPrompt = this.buildFullPrompt(systemPrompt, documentText, prompt, additionalContext);
    
    // Intentar primero con el método legacy que podría funcionar
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fullPrompt }
        ],
        max_completion_tokens: 2000, // CORRECTO para GPT-5
        response_format: { type: 'json_object' }
      });
      
      const rawContent = response.choices[0].message.content?.trim() || '';
      
      if (!rawContent) {
        throw new Error('GPT-5 returned empty response');
      }
      
      let result;
      try {
        result = JSON.parse(rawContent);
      } catch (parseError) {
        // Si no es JSON válido, intentar extraerlo
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          throw parseError;
        }
      }
      
      this.logger.log(`✅ GPT-5 found: "${result.response}" (confidence: ${result.confidence}) - legacy method`);
      
      return {
        response: result.response || result.answer || 'No response',
        confidence: result.confidence || 0.8,
        reasoning: result.reasoning || 'GPT-5 reasoning',
        model: 'gpt-5'
      };
      
    } catch (firstError) {
      this.logger.warn(`⚠️ GPT-5 legacy method failed: ${firstError.message}`);
      
      // Fallback: Intentar con diferentes parámetros
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-5',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: fullPrompt }
          ],
          max_completion_tokens: 2000, // Usar max_completion_tokens como alternativa
          reasoning_effort: "medium", // Reducir reasoning effort
          response_format: { type: 'json_object' }
        });
        
        const rawContent = response.choices[0].message.content?.trim() || '';
        
        if (!rawContent) {
          throw new Error('GPT-5 returned empty response (alternative params)');
        }
        
        let result;
        try {
          result = JSON.parse(rawContent);
        } catch (parseError) {
          const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            result = JSON.parse(jsonMatch[0]);
          } else {
            throw parseError;
          }
        }
        
        this.logger.log(`✅ GPT-5 found: "${result.response}" (confidence: ${result.confidence}) - alternative params`);
        
        return {
          response: result.response || result.answer || 'No response',
          confidence: result.confidence || 0.8,
          reasoning: result.reasoning || 'GPT-5 reasoning',
          model: 'gpt-5'
        };
        
      } catch (secondError) {
        this.logger.error(`❌ All GPT-5 attempts failed`);
        this.logger.error(`   First error: ${firstError.message}`);
        this.logger.error(`   Second error: ${secondError.message}`);
        throw new Error(`GPT-5 evaluation failed after all attempts: ${secondError.message}`);
      }
    }
  }

  /**
   * Invoca GPT-5 como juez árbitro con manejo robusto de errores
   */
  private async invokeGPT5Judge(
    documentText: string,
    prompt: string,
    result1: any,
    result2: any,
    expectedType: ResponseType,
    pmcField?: string
  ): Promise<any> {
    const judgePrompt = `As an expert arbitrator, analyze these two AI evaluations and determine the correct answer.

Document Context: ${documentText.substring(0, 3000)}...
Question: ${prompt}
Field: ${pmcField}

Evaluation 1 (GPT-5): 
Response: ${result1.response}
Confidence: ${result1.confidence}
Reasoning: ${result1.reasoning || 'No reasoning provided'}

Evaluation 2 (Gemini 2.5 Pro):
Response: ${result2.response}  
Confidence: ${result2.confidence}
Reasoning: ${result2.reasoning || 'No reasoning provided'}

Provide your arbitration decision in JSON format:
{
  "finalAnswer": "your definitive answer",
  "confidence": 0.0 to 1.0,
  "reasoning": "detailed explanation of your decision",
  "selectedModel": "gpt-5" | "gemini" | "synthesized"
}`;

    // Intentar con múltiples configuraciones de parámetros
    let response;
    try {
      response = await this.openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert arbitrator for insurance underwriting decisions.' 
          },
          { role: 'user', content: judgePrompt }
        ],
        max_completion_tokens: 1000, // CORRECTO para GPT-5
        response_format: { type: 'json_object' }
      });
    } catch (firstError) {
      this.logger.warn(`⚠️ GPT-5 judge first attempt failed: ${firstError.message}`);
      
      // Fallback con parámetros alternativos
      try {
        response = await this.openai.chat.completions.create({
          model: 'gpt-5',
          messages: [
            { 
              role: 'system', 
              content: 'You are an expert arbitrator. Respond with valid JSON only.' 
            },
            { role: 'user', content: judgePrompt }
          ],
          max_completion_tokens: 1000,
          reasoning_effort: "minimal", // Reducir esfuerzo para respuesta más rápida
          response_format: { type: 'json_object' }
        });
      } catch (secondError) {
        this.logger.error(`❌ GPT-5 judge failed completely: ${secondError.message}`);
        // Fallback simple: elegir el de mayor confianza
        const higherConfidence = result1.confidence >= result2.confidence ? result1 : result2;
        return {
          finalAnswer: higherConfidence.response,
          confidence: higherConfidence.confidence * 0.9, // Reducir confianza por falta de arbitraje
          reasoning: `Fallback: Selected ${higherConfidence === result1 ? 'GPT-5' : 'Gemini'} due to higher confidence`,
          selectedModel: higherConfidence === result1 ? 'gpt-5' : 'gemini'
        };
      }
    }

    // Manejo robusto de respuesta JSON del juez final
    const rawJudgeContent = response.choices[0].message.content?.trim() || '';
    
    if (!rawJudgeContent) {
      this.logger.error(`❌ GPT-5 judge returned empty response`);
      const higherConfidence = result1.confidence >= result2.confidence ? result1 : result2;
      return {
        finalAnswer: higherConfidence.response,
        confidence: higherConfidence.confidence * 0.9,
        reasoning: `Fallback: GPT-5 judge returned empty, using ${higherConfidence === result1 ? 'GPT-5' : 'Gemini'}`,
        selectedModel: higherConfidence === result1 ? 'gpt-5' : 'gemini'
      };
    }
    
    try {
      return JSON.parse(rawJudgeContent);
    } catch (parseError) {
      // Intentar extraer JSON parcial
      const jsonMatch = rawJudgeContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (retryError) {
          this.logger.error(`❌ Final judge JSON recovery failed: ${retryError.message}`);
        }
      }
      
      this.logger.error(`❌ Final judge JSON parse error: ${parseError.message}`);
      this.logger.error(`📝 Final judge raw content: ${rawJudgeContent}`);
      
      // Fallback final
      const higherConfidence = result1.confidence >= result2.confidence ? result1 : result2;
      return {
        finalAnswer: higherConfidence.response,
        confidence: higherConfidence.confidence * 0.85,
        reasoning: `Fallback: Judge parsing failed, using ${higherConfidence === result1 ? 'GPT-5' : 'Gemini'}`,
        selectedModel: higherConfidence === result1 ? 'gpt-5' : 'gemini'
      };
    }
  }

  /**
   * Construye system prompt optimizado para GPT-5
   */
  private buildGPT5SystemPrompt(expectedType: ResponseType): string {
    return `<role>
You are an expert insurance underwriting analyst powered by GPT-5. Your task is to extract precise information from insurance documents with high accuracy and confidence.
</role>

<domain_expertise>
- Insurance policy analysis and interpretation
- Document structure recognition and data extraction
- Regulatory compliance and underwriting standards
- Risk assessment and claim validation
</domain_expertise>

<response_requirements>
Expected response type: ${expectedType}

<response_format>
Provide your analysis in valid JSON format:
{
  "response": "your precise answer based on document analysis",
  "confidence": 0.0 to 1.0,
  "reasoning": "detailed step-by-step reasoning process"
}
</response_format>
</response_requirements>

<analysis_instructions>
1. READ: Thoroughly analyze the entire document content
2. IDENTIFY: Locate relevant sections and data points
3. EXTRACT: Pull exact information matching the expected response type
4. VALIDATE: Cross-reference findings for accuracy
5. REASON: Document your logical process clearly
6. RESPOND: Provide precise, confident answers
</analysis_instructions>

<quality_standards>
- Accuracy is paramount - never guess or approximate
- Use exact quotes when possible
- If uncertain, clearly state limitations
- Maintain high confidence only when evidence is clear
- For dates, always convert to MM-DD-YY format (e.g., 07-22-25)
</quality_standards>`;
  }

  /**
   * Construye prompt completo
   */
  private buildFullPrompt(
    systemPrompt: string,
    documentText: string,
    prompt: string,
    additionalContext?: string
  ): string {
    let fullPrompt = '';
    
    if (additionalContext) {
      fullPrompt += `Additional Context: ${additionalContext}\n\n`;
    }
    
    fullPrompt += `Document Content:\n${documentText}\n\n`;
    fullPrompt += `Question: ${prompt}`;
    
    return fullPrompt;
  }

  /**
   * Normaliza respuestas para comparación (especialmente fechas)
   */
  private normalizeForComparison(response: string, expectedType: ResponseType): string {
    if (!response || response === 'NOT_FOUND') {
      return response;
    }
    
    // Para fechas, normalizar diferentes formatos a MM-DD-YY
    if (expectedType === ResponseType.DATE) {
      // Intentar parsear diferentes formatos de fecha
      const datePatterns = [
        /(\d{2})-(\d{2})-(\d{2})/,       // 07-22-25
        /(\d{4})-(\d{2})-(\d{2})/,      // 2025-07-22
        /(\d{2})\/(\d{2})\/(\d{2})/,    // 07/22/25
        /(\d{2})\/(\d{2})\/(\d{4})/,    // 07/22/2025
        /(\d{4})\/(\d{2})\/(\d{2})/,    // 2025/07/22
      ];
      
      for (const pattern of datePatterns) {
        const match = response.match(pattern);
        if (match) {
          let year = match[1];
          let month = match[2];
          let day = match[3];
          
          // Para formatos como MM-DD-YY mantenemos el orden
          if (pattern.source.includes('(\\d{2})-(\\d{2})-(\\d{2})')) {
            // Asumir formato MM-DD-YY
            month = match[1];
            day = match[2];
            year = match[3];
            
            // Convertir año corto a largo
            if (year.length === 2) {
              const currentYear = new Date().getFullYear();
              const currentCentury = Math.floor(currentYear / 100) * 100;
              year = String(currentCentury + parseInt(year));
            }
          }
          
          // Para formatos YYYY-MM-DD convertir a MM-DD-YY
          if (pattern.source.includes('(\\d{4})-(\\d{2})-(\\d{2})')) {
            // YYYY-MM-DD -> MM-DD-YY\n            year = match[1].slice(-2);\n            month = match[2];\n            day = match[3];
          }
          
          // Para formatos MM/DD/YY
          if (pattern.source.includes('\\/')) {
            if (year.length === 2) {
              const currentYear = new Date().getFullYear();
              const currentCentury = Math.floor(currentYear / 100) * 100;
              year = String(currentCentury + parseInt(year));
            }
            // Intercambiar mes y día si es necesario (formato americano)
            // Mantener como está por ahora, puede necesitar ajuste según contexto
          }
          
          // Normalizar a MM-DD-YY
          if (year.length === 4) {
            year = year.slice(-2);
          }
          return `${month.padStart(2, '0')}-${day.padStart(2, '0')}-${year.padStart(2, '0')}`;
        }
      }
    }
    
    // Para booleanos, normalizar variaciones
    if (expectedType === ResponseType.BOOLEAN) {
      const lower = response.toLowerCase().trim();
      if (lower === 'yes' || lower === 'true' || lower === '1') return 'YES';
      if (lower === 'no' || lower === 'false' || lower === '0') return 'NO';
    }
    
    // Para otros tipos, limpiar espacios y normalizar caso
    return response.trim().toLowerCase();
  }

  /**
   * Calcula nivel de acuerdo entre dos respuestas (versión simplificada)
   */
  private calculateNewAgreement(response1: string, response2: string): number {
    const normalized1 = this.normalizeNewResponse(response1);
    const normalized2 = this.normalizeNewResponse(response2);
    
    if (normalized1 === normalized2) return 1.0;
    
    // Similitud básica por palabras
    const words1 = normalized1.split(' ');
    const words2 = normalized2.split(' ');
    const intersection = words1.filter(w => words2.includes(w));
    
    return intersection.length / Math.max(words1.length, words2.length, 1);
  }

  /**
   * Normaliza respuesta para comparación (versión simplificada)
   */
  private normalizeNewResponse(response: string): string {
    const responseStr = typeof response === 'string' 
      ? response 
      : (response as any)?.response || JSON.stringify(response);
    
    const cleaned = responseStr.toLowerCase().trim();
    
    // FIXED: Boolean normalization to prevent "true" vs "YES" discrepancies
    if (cleaned === 'yes' || cleaned === 'true' || cleaned === '1' || cleaned === 'sí') {
      return 'YES';
    }
    if (cleaned === 'no' || cleaned === 'false' || cleaned === '0') {
      return 'NO';
    }
    
    return responseStr
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Procesa documentos ultra masivos (>100MB de texto) con chunking inteligente
   */
  private processUltraMassiveDocument(documentText: string, prompt: string): string {
    this.logger.log(`🚀 Iniciando procesamiento ultra masivo: ${(documentText.length/1024/1024).toFixed(2)}MB`);
    
    // Estrategia: Buscar solo en secciones relevantes
    const keywordMap = this.getRelevantKeywords(prompt.toLowerCase());
    const ULTRA_CHUNK_SIZE = 20000; // 20K chars por chunk
    
    // Calcular límite dinámico basado en configuración
    const configLimit = openaiConfig.maxTextLength;
    const safeLimit = Math.min(configLimit * 0.8, 12000); // 80% del límite configurado, máximo 12K
    const maxChunks = Math.max(1, Math.floor(safeLimit / 2000)); // Mínimo 1 chunk
    
    this.logger.log(`📊 Límite configurado: ${configLimit}, límite seguro: ${safeLimit}, max chunks: ${maxChunks}`);
    
    const chunks: Array<{content: string, score: number, position: number}> = [];
    
    // Dividir en chunks
    for (let i = 0; i < documentText.length; i += ULTRA_CHUNK_SIZE) {
      const chunk = documentText.slice(i, Math.min(i + ULTRA_CHUNK_SIZE, documentText.length));
      const score = this.scoreChunkRelevance(chunk, keywordMap);
      
      chunks.push({
        content: chunk,
        score: score,
        position: i
      });
      
      // Procesar solo una muestra para encontrar chunks relevantes rápidamente
      if (chunks.length > 50) break;
    }
    
    // Ordenar por relevancia y tomar los mejores
    const bestChunks = chunks
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks)
      .map(chunk => chunk.content);
    
    // Ensamblar resultado respetando el límite
    let result = '';
    let totalSize = 0;
    for (const chunk of bestChunks) {
      const separator = result ? '\n\n---CHUNK SEPARATOR---\n\n' : '';
      const addition = separator + chunk;
      
      if (totalSize + addition.length <= safeLimit) {
        result += addition;
        totalSize += addition.length;
      } else {
        break; // Parar antes de exceder el límite
      }
    }
    
    this.logger.log(`✅ Procesamiento ultra masivo completado: ${bestChunks.length} chunks disponibles, ${result.length} chars finales`);
    
    return result;
  }

  /**
   * Procesa documentos grandes con chunking mejorado
   */
  private processLargeDocumentWithChunking(documentText: string, prompt: string): string {
    this.logger.log(`📊 Procesamiento con chunking mejorado: ${(documentText.length/1000).toFixed(0)}K chars`);
    
    const keywordMap = this.getRelevantKeywords(prompt.toLowerCase());
    const CHUNK_SIZE = 8000;
    const OVERLAP = 500;
    
    // Calcular límite dinámico basado en configuración
    const configLimit = openaiConfig.maxTextLength;
    const MAX_FINAL_SIZE = Math.min(configLimit * 0.8, 12000); // 80% del límite configurado
    
    this.logger.log(`📊 Límite configurado: ${configLimit}, límite final: ${MAX_FINAL_SIZE}`);
    
    const chunks: string[] = [];
    
    // Crear chunks con overlap
    for (let i = 0; i < documentText.length; i += CHUNK_SIZE - OVERLAP) {
      const chunk = documentText.slice(i, i + CHUNK_SIZE);
      chunks.push(chunk);
      
      if (chunks.length > 20) break; // Máximo 20 chunks para evaluar
    }
    
    // Scoring y selección de mejores chunks
    const scoredChunks = chunks.map((chunk, index) => ({
      content: chunk,
      score: this.scoreChunkRelevance(chunk, keywordMap),
      index: index
    }));
    
    // Seleccionar mejores chunks hasta llenar el límite
    const selectedChunks: string[] = [];
    let totalSize = 0;
    
    scoredChunks
      .sort((a, b) => b.score - a.score)
      .forEach(chunk => {
        if (totalSize + chunk.content.length <= MAX_FINAL_SIZE) {
          selectedChunks.push(chunk.content);
          totalSize += chunk.content.length;
        }
      });
    
    const result = selectedChunks.join('\n\n---SECTION---\n\n');
    this.logger.log(`✅ Chunking completado: ${selectedChunks.length} chunks, ${result.length} chars`);
    
    return result;
  }

  /**
   * Puntúa la relevancia de un chunk basado en palabras clave
   */
  private scoreChunkRelevance(chunk: string, keywordMap: string[]): number {
    const chunkLower = chunk.toLowerCase();
    let score = 0;
    
    // Puntuación por palabras clave
    keywordMap.forEach(keyword => {
      const occurrences = (chunkLower.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
      score += occurrences * 2; // 2 puntos por cada ocurrencia
    });
    
    // Bonus por presencia de números (importante para fechas, cantidades, etc.)
    const numberMatches = chunk.match(/\d+/g) || [];
    score += numberMatches.length * 0.5;
    
    // Bonus por presencia de fechas
    const dateMatches = chunk.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/g) || [];
    score += dateMatches.length * 3;
    
    return score;
  }
}