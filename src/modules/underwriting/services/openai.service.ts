import { Injectable, Logger } from '@nestjs/common';
import { openaiConfig, processingConfig } from '../../../config/openai.config';
import { modelConfig } from '../../../config/model.config';
import { ResponseType } from '../entities/uw-evaluation.entity';
import { JudgeValidatorService } from './judge-validator.service';
import { RateLimiterService } from './rate-limiter.service';
import { ClaudeRateLimiterService } from './claude-rate-limiter.service';
import { ClaudeChunkingService } from './claude-chunking.service';
// NUEVO: Servicios mejorados (inicialmente no se usan)
import { GeminiService } from './gemini.service';
import { EnhancedChunkingService } from './enhanced-chunking.service';

const { OpenAI } = require('openai');
const { Anthropic } = require('@anthropic-ai/sdk');

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
  private openai: any;
  private claudeClient?: any; // Cliente Claude opcional
  private rateLimiter: RateLimiterService;
  private claudeRateLimiter: ClaudeRateLimiterService;
  private claudeChunking: ClaudeChunkingService;
  
  // NUEVO: Servicios mejorados (inicialmente no se usan)
  private geminiService?: GeminiService;
  private enhancedChunking?: EnhancedChunkingService;

  constructor(private judgeValidator: JudgeValidatorService) {
    this.rateLimiter = new RateLimiterService();
    this.claudeRateLimiter = new ClaudeRateLimiterService();
    this.claudeChunking = new ClaudeChunkingService();
    
    // NUEVO: Inicializar servicios mejorados solo si están habilitados
    if (modelConfig.migration.shouldUseNewSystem()) {
      try {
        this.geminiService = new GeminiService();
        this.enhancedChunking = new EnhancedChunkingService();
        this.logger.log('🚀 Servicios mejorados inicializados (modo: ' + modelConfig.migration.mode + ')');
      } catch (error) {
        this.logger.warn(`⚠️ No se pudieron inicializar servicios mejorados: ${error.message}`);
      }
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
    
    // Inicializar cliente Claude si está disponible (nuevo)
    if (modelConfig.isClaudeAvailable()) {
      try {
        this.claudeClient = new Anthropic({
          apiKey: modelConfig.claude.apiKey,
          baseURL: modelConfig.claude.baseURL,
          timeout: modelConfig.claude.timeout,
          maxRetries: modelConfig.claude.maxRetries,
        });
        this.logger.log('✅ Cliente Claude Sonnet 4 inicializado correctamente');
      } catch (error) {
        this.logger.warn(`⚠️ No se pudo inicializar cliente Claude: ${error.message}`);
        this.claudeClient = null;
      }
    }
  }

  async evaluateWithValidation(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string,
    pmcField?: string
  ): Promise<EvaluationResult> {
    try {
      this.logger.log(`Evaluando prompt: "${prompt.substring(0, 50)}..."`);

      // Verificar si OpenAI está habilitado
      if (!openaiConfig.enabled) {
        throw new Error('OpenAI está deshabilitado');
      }

      // Optimización: Usar chunking inteligente para documentos grandes
      const relevantText = this.extractRelevantChunks(documentText, prompt);
      this.logger.log(`Texto optimizado: ${relevantText.length} caracteres (original: ${documentText.length})`);

      // Verificar tamaño del texto optimizado
      if (relevantText.length > openaiConfig.maxTextLength) {
        this.logger.warn(`Texto excede el límite de ${openaiConfig.maxTextLength} caracteres`);
        if (openaiConfig.fallbackToLocal) {
          throw new Error('Texto muy largo, se requiere procesamiento local');
        }
        throw new Error(`El texto excede el límite máximo de ${openaiConfig.maxTextLength} caracteres`);
      }

      // NUEVO: Verificar si usar sistema de migración
      if (modelConfig.migration.shouldUseNewSystem() && this.geminiService && this.enhancedChunking) {
        this.logger.log('🆕 Usando sistema de migración: GPT-5 + Gemini 2.5 Pro');
        return await this.evaluateWithNewArchitecture(documentText, prompt, expectedType, additionalContext, pmcField);
      }
      
      // SISTEMA ACTUAL: Selección de estrategia de validación basada en configuración
      const validationStrategy = modelConfig.getValidationStrategy();
      
      if (validationStrategy === 'triple' && this.claudeClient) {
        // Nueva validación triple con Claude
        this.logger.log('🔺 Usando validación triple: GPT-4o + Claude Sonnet 4 + GPT-4o Árbitro');
        return await this.evaluateWithTripleValidation(documentText, relevantText, prompt, expectedType, additionalContext, pmcField);
      } else if (validationStrategy === 'triple' && !this.claudeClient) {
        // Fallback a dual si triple está activado pero Claude no disponible
        this.logger.warn('⚠️ Triple validación configurada pero Claude no disponible, usando validación dual');
        return await this.evaluateWithDualValidation(relevantText, prompt, expectedType, additionalContext, pmcField);
      } else if (openaiConfig.dualValidation) {
        // Validación dual existente
        return await this.evaluateWithDualValidation(relevantText, prompt, expectedType, additionalContext, pmcField);
      } else {
        // Fallback a evaluación simple
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
          }
        };
      }
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
          max_completion_tokens: openaiConfig.maxTokens,
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
    let basePrompt = `You are a precise document analyzer for underwriting purposes. `;
    
    if (isValidation) {
      basePrompt += `You are performing a validation check on a previous analysis. `;
    }

    basePrompt += `Your responses must be extremely accurate and reliable.

RESPONSE FORMAT REQUIREMENTS:
`;

    // Formato especial para el campo 'state'
    if (pmcField === 'state') {
      basePrompt += `- Respond with state in format "XX StateName" (e.g., "CA California", "TX Texas", "FL Florida")
- Use the 2-letter state code followed by space and full state name
- If no state found, respond "not found"
- Include confidence level: [CONFIDENCE: 0.XX] at the end`;
    } else {
      // Formatos normales para otros campos
      switch (expectedType) {
        case ResponseType.BOOLEAN:
          basePrompt += `- Respond with ONLY "YES" or "NO" (uppercase)
- Do NOT use lowercase "yes" or "no"
- Include confidence level: [CONFIDENCE: 0.XX] at the end`;
          break;
        case ResponseType.DATE:
          basePrompt += `- Respond with date in MM-DD-YY format only (e.g., 12-25-24 for December 25, 2024)
- If no date found, respond "not found"
- Include confidence level: [CONFIDENCE: 0.XX] at the end`;
          break;
        case ResponseType.TEXT:
          basePrompt += `- Provide concise, factual response
- Maximum 100 characters
- Include confidence level: [CONFIDENCE: 0.XX] at the end`;
          break;
        case ResponseType.NUMBER:
          basePrompt += `- Respond with number only (no currency symbols or units unless specified)
- If no number found, respond "not found"
- Include confidence level: [CONFIDENCE: 0.XX] at the end`;
          break;
        case ResponseType.JSON:
          basePrompt += `- Respond with valid JSON only
- Include confidence level inside JSON as "confidence": 0.XX`;
          break;
      }
    }

    if (additionalContext) {
      basePrompt += `\n\nADDITIONAL CONTEXT: ${additionalContext}`;
    }

    return basePrompt;
  }

  private buildUserPrompt(documentText: string, prompt: string): string {
    return `DOCUMENT TEXT:
${documentText}

QUESTION: ${prompt}

Please analyze the document and provide your response following the format requirements.`;
  }

  private buildValidationPrompt(originalPrompt: string, originalResponse: string, expectedType: ResponseType): string {
    return `VALIDATION CHECK: Please verify if the response "${originalResponse}" is correct for the question: "${originalPrompt}". 
    
If you agree with the response, provide the same answer. If you disagree, provide the correct answer. 
Be very careful and thorough in your analysis.`;
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
    // LÍMITE ABSOLUTO - no procesar documentos mayores a 50k caracteres
    if (documentText.length > 50000) {
      this.logger.warn(`⚠️ Documento muy largo (${documentText.length} chars) - truncando a 8000 caracteres`);
      return documentText.substring(0, 8000) + "\n\n...[DOCUMENTO TRUNCADO - MUY LARGO]";
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

  async evaluateWithDualValidation(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string,
    pmcField?: string
  ): Promise<EvaluationResult> {
    this.logger.log(`🔄 Usando validación dual: ${openaiConfig.model} + ${openaiConfig.validationModel}`);

    // 1. Evaluación inicial con modelo rápido
    const primaryResult = await this.evaluatePrompt(
      documentText, 
      prompt, 
      expectedType, 
      additionalContext,
      openaiConfig.model, // gpt-4o-mini
      pmcField
    );

    // 2. Validación con modelo premium
    const validationResult = await this.validateResponse(
      documentText, 
      prompt, 
      primaryResult.response, 
      expectedType,
      additionalContext,
      openaiConfig.validationModel // gpt-4o
    );

    // 3. LOGGING PREVIO AL JUEZ - Mostrar las dos respuestas que se van a juzgar
    this.logger.log(`🔄 DUAL VALIDATION RESULTS for ${pmcField}:`);
    this.logger.log(`   📊 Primary Model (${openaiConfig.model}): "${primaryResult.response}" (confidence: ${primaryResult.confidence})`);
    this.logger.log(`   📊 Validation Model (${openaiConfig.validationModel}): "${validationResult.response}" (confidence: ${validationResult.confidence})`);
    
    // Determinar si hay discrepancia
    const hasDiscrepancy = primaryResult.response !== validationResult.response;
    if (hasDiscrepancy) {
      this.logger.warn(`⚠️ DISCREPANCY DETECTED - Models disagreed! Invoking judge...`);
    } else {
      this.logger.log(`✅ CONSENSUS - Models agreed! Judge will confirm...`);
    }

    // 4. Análisis inteligente con juez
    const judgeDecision = await this.judgeValidator.judgeResponses(
      documentText,
      prompt,
      {
        response: primaryResult.response,
        confidence: primaryResult.confidence,
        model: openaiConfig.model
      },
      {
        response: validationResult.response,
        confidence: validationResult.confidence,
        model: openaiConfig.validationModel
      },
      expectedType,
      pmcField
    );

    // 5. LOGGING DETALLADO DE LA DECISIÓN DEL JUEZ
    this.logger.log(`⚖️ JUDGE DECISION for ${pmcField}:`);
    this.logger.log(`   🎯 Selected: ${judgeDecision.selectedModel.toUpperCase()} model`);
    this.logger.log(`   📝 Final Answer: "${judgeDecision.finalAnswer}"`);
    this.logger.log(`   📊 Final Confidence: ${judgeDecision.confidence}`);
    this.logger.log(`   🧠 Judge Reasoning: ${judgeDecision.reasoning}`);
    if (judgeDecision.discrepancyAnalysis) {
      this.logger.log(`   🔍 Discrepancy Analysis: ${judgeDecision.discrepancyAnalysis}`);
    }

    return {
      response: judgeDecision.finalAnswer,
      confidence: primaryResult.confidence,
      validation_response: validationResult.response,
      validation_confidence: validationResult.confidence,
      final_confidence: judgeDecision.confidence,
      openai_metadata: {
        primary_model: openaiConfig.model,
        validation_model: openaiConfig.validationModel,
        primary_tokens: primaryResult.tokens_used,
        validation_tokens: validationResult.tokens_used,
        judge_selected: judgeDecision.selectedModel,
        judge_reasoning: judgeDecision.reasoning,
        discrepancy_analysis: judgeDecision.discrepancyAnalysis
      }
    };
  }

  private async validateResponse(
    documentText: string,
    originalPrompt: string,
    originalResponse: string,
    expectedType: ResponseType,
    additionalContext?: string,
    modelOverride?: string
  ): Promise<{ response: string; confidence: number; tokens_used: number }> {
    const validationPrompt = this.buildValidationPrompt(originalPrompt, originalResponse, expectedType);
    const systemPrompt = this.buildSystemPrompt(expectedType, additionalContext, true);
    const userPrompt = this.buildUserPrompt(documentText, validationPrompt);
    const modelToUse = modelOverride || openaiConfig.validationModel;

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
          max_completion_tokens: openaiConfig.maxTokens,
          reasoning_effort: "medium", // GPT-5 specific: enhanced analysis depth
        });
      },
      `validation_${modelToUse.replace(/[^a-zA-Z0-9]/g, '_')}`,
      'normal' // Prioridad normal para validación
    );

    const response = completion.choices[0].message.content.trim();
    const confidence = this.extractConfidence(response);
    const cleanResponse = this.cleanResponse(response, expectedType);

    return {
      response: cleanResponse,
      confidence: confidence,
      tokens_used: completion.usage?.total_tokens || 0
    };
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
      this.logger.log(`🎯 Vision API for: ${pmcField} (page ${pageNumber})`);
      
      if (!openaiConfig.enabled) {
        throw new Error('OpenAI está deshabilitado');
      }

      // Construir prompt específico para análisis visual
      const visionPrompt = this.buildVisionPrompt(prompt, expectedType, pmcField);
      
      // Usar rate limiter con alta prioridad para Vision API
      const completion = await this.rateLimiter.executeWithRateLimit(
        async () => {
          return await this.openai.chat.completions.create({
            model: "gpt-5",
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
            max_completion_tokens: 500, // GPT-5: increased for detailed visual analysis
            // temperature: 1, // GPT-5: Only default value (1) supported - removed parameter // GPT-5 optimized for vision tasks
            reasoning_effort: "medium" // GPT-5: balanced visual analysis
          });
        },
        `vision_${pmcField || 'field'}_page${pageNumber}`,
        'high' // Alta prioridad para Vision API
      );

      const response = completion.choices[0].message.content.trim();
      const confidence = this.extractConfidence(response);
      const cleanResponse = this.cleanResponse(response, expectedType);

      // Para Vision, no usamos validación dual (ya es el modelo más avanzado)
      return {
        response: cleanResponse,
        confidence: confidence,
        validation_response: cleanResponse,
        validation_confidence: confidence,
        final_confidence: confidence,
        openai_metadata: {
          primary_model: 'gpt-4o',
          validation_model: 'none',
          primary_tokens: completion.usage?.total_tokens || 0,
          validation_tokens: 0,
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
        this.logger.warn(`🔄 Vision API failed for signature field ${pmcField} - attempting text analysis fallback`);
        
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
      date: '<output_format>Answer with ONLY the date in YYYY-MM-DD format (e.g., 2025-07-18).</output_format>',
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
        
        return response.toLowerCase();
      default:
        return response.toLowerCase().trim();
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
   * Evalúa un documento usando Claude Sonnet 4 con contexto completo (sin chunking)
   * @param documentText Documento completo sin chunking
   * @param prompt Pregunta a evaluar
   * @param expectedType Tipo de respuesta esperada
   * @param additionalContext Contexto adicional opcional
   * @param pmcField Campo PMC para logging
   */
  private async evaluateWithClaude(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string,
    pmcField?: string
  ): Promise<{ response: string; confidence: number; tokens_used: number; model_used: string }> {
    if (!this.claudeClient) {
      throw new Error('Cliente Claude no disponible');
    }

    const startTime = Date.now();
    this.logger.log(`🤖 Evaluando con Claude Sonnet 4 (documento: ${documentText.length} chars, timeout: ${modelConfig.claude.timeout}ms)`);

    // Determinar estrategia de chunking
    const chunkingStrategy = this.claudeChunking.determineChunkingStrategy(documentText, prompt, pmcField);
    this.logger.log(`📋 Chunking strategy: ${chunkingStrategy.reason}`);

    // Auto-fallback si el documento es demasiado grande incluso para chunking
    if (documentText.length > modelConfig.claude.maxDocumentLength * 2 && modelConfig.claude.autoFallback) {
      this.logger.warn(`⚠️ Documento extremadamente grande (${documentText.length} chars), using GPT-4o fallback`);
      throw new Error(`Document too large for Claude, auto-fallback triggered: ${documentText.length} characters`);
    }

    try {
      // Crear chunks si es necesario
      const chunks = this.claudeChunking.chunkDocument(documentText, chunkingStrategy, prompt, pmcField);
      
      // Procesador Claude para chunks
      const claudeProcessor = async (content: string, chunkPrompt: string) => {
        const systemPrompt = `You are Claude Sonnet 4, a highly capable AI assistant specialized in document analysis.
${this.buildSystemPrompt(expectedType, additionalContext, false, pmcField)}

IMPORTANT: Provide accurate analysis based on the content provided. If information is not found in the provided content, respond with "NOT_FOUND".`;

        const userPrompt = `DOCUMENT CONTENT:
${content}

QUESTION TO ANSWER:
${chunkPrompt}`;

        // Estimar tokens para rate limiting
        const estimatedInputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 3.5);
        
        const completion = await this.claudeRateLimiter.executeWithClaudeRateLimit(
          async () => {
            return await this.claudeClient.messages.create({
              model: modelConfig.claude.model,
              max_completion_tokens: modelConfig.claude.maxTokens,
              temperature: modelConfig.claude.temperature,
              system: systemPrompt,
              messages: [
                { role: 'user', content: userPrompt }
              ]
            });
          },
          `claude_chunk_${pmcField || 'field'}`,
          estimatedInputTokens,
          'normal'
        );

        const response = completion.content[0].text.trim();
        const confidence = this.extractConfidence(response);
        
        return {
          response: this.cleanResponse(response, expectedType),
          confidence: confidence
        };
      };

      // Procesar chunks con Claude
      const result = await this.claudeChunking.processChunksWithClaude(
        chunks, 
        prompt, 
        pmcField || 'field',
        claudeProcessor
      );

      const elapsedTime = Date.now() - startTime;
      
      if (modelConfig.claude.performanceLogging) {
        this.logger.log(`📊 Claude Performance: ${elapsedTime}ms, ${result.chunksProcessed} chunks, confidence: ${result.confidence}`);
      }
      
      this.logger.log(`✅ Claude Sonnet 4 completado en ${elapsedTime}ms - Confianza: ${result.confidence} (${result.chunksProcessed} chunks)`);

      return {
        response: result.response,
        confidence: result.confidence,
        tokens_used: chunks.reduce((sum, chunk) => sum + chunk.tokens, 0), // Approximate
        model_used: `${modelConfig.claude.model} (${result.chunksProcessed} chunks)`
      };

    } catch (error) {
      const elapsedTime = Date.now() - startTime;
      
      // Clasificar tipos de error para mejor debugging
      if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT') {
        this.logger.error(`⏰ Claude timeout después de ${elapsedTime}ms (límite: ${modelConfig.claude.timeout}ms). Documento: ${documentText.length} chars`);
      } else if (error.status === 429) {
        this.logger.error(`🚫 Claude rate limit hit después de ${elapsedTime}ms`);
      } else {
        this.logger.error(`❌ Error en evaluación con Claude después de ${elapsedTime}ms: ${error.message}`);
      }
      
      // Log Claude rate limiter stats para debugging
      this.claudeRateLimiter.logStats();
      
      throw error;
    }
  }

  /**
   * Sistema de triple validación: GPT-4o + Claude Sonnet 4 + GPT-4o Árbitro
   * @param fullDocument Documento completo para Claude
   * @param chunkedDocument Documento con chunking para GPT
   * @param prompt Pregunta a evaluar
   * @param expectedType Tipo de respuesta esperada
   * @param additionalContext Contexto adicional
   * @param pmcField Campo PMC
   */
  private async evaluateWithTripleValidation(
    fullDocument: string,
    chunkedDocument: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string,
    pmcField?: string
  ): Promise<EvaluationResult> {
    const startTime = Date.now();
    this.logger.log(`🔺 Iniciando validación triple para: ${pmcField || 'campo'}`);

    try {
      // Ejecutar evaluaciones en paralelo para mejor performance
      const [gptResult, claudeResult] = await Promise.allSettled([
        // 1. GPT-4o con chunking inteligente
        this.evaluatePrompt(
          chunkedDocument,
          prompt,
          expectedType,
          additionalContext,
          modelConfig.validation.triple.models.primary,
          pmcField
        ),
        // 2. Claude Sonnet 4 con documento completo
        this.evaluateWithClaude(
          fullDocument,
          prompt,
          expectedType,
          additionalContext,
          pmcField
        )
      ]);

      // Manejo de resultados
      let primaryResult: any = null;
      let independentResult: any = null;

      if (gptResult.status === 'fulfilled') {
        primaryResult = gptResult.value;
      } else {
        this.logger.error(`Error en evaluación GPT: ${gptResult.reason}`);
      }

      if (claudeResult.status === 'fulfilled') {
        independentResult = claudeResult.value;
      } else {
        this.logger.error(`Error en evaluación Claude: ${claudeResult.reason}`);
      }

      // Si ambas evaluaciones fallaron, lanzar error
      if (!primaryResult && !independentResult) {
        throw new Error('Ambas evaluaciones fallaron en validación triple');
      }

      // Si solo una falló, usar validación dual con el resultado disponible
      if (!primaryResult || !independentResult) {
        this.logger.warn('⚠️ Una evaluación falló, degradando a validación dual');
        const availableResult = primaryResult || independentResult;
        
        // Validar con GPT-4o (usar modelo correcto, no el nombre del campo)
        const validationResult = await this.validateResponse(
          chunkedDocument,
          prompt,
          availableResult.response,
          expectedType,
          additionalContext,
          modelConfig.validation.triple.models.arbitrator // Usar modelo correcto
        );

        return {
          response: validationResult.response,
          confidence: validationResult.confidence,
          validation_response: validationResult.response,
          validation_confidence: validationResult.confidence,
          final_confidence: validationResult.confidence,
          openai_metadata: {
            validation_strategy: 'dual_fallback',
            primary_model: availableResult.model_used || modelConfig.validation.triple.models.primary,
            validation_model: modelConfig.openai.validationModel,
            primary_tokens: availableResult.tokens_used || 0,
            validation_tokens: validationResult.tokens_used,
            fallback_reason: 'One model failed in triple validation'
          }
        };
      }

      // 3. Árbitro GPT-4o compara ambas respuestas
      const arbitrationResult = await this.arbitrateWithGPT4o(
        primaryResult,
        independentResult,
        prompt,
        expectedType,
        chunkedDocument,
        pmcField
      );

      const elapsedTime = Date.now() - startTime;
      this.logger.log(`✅ Validación triple completada en ${elapsedTime}ms`);

      return arbitrationResult;

    } catch (error) {
      this.logger.error(`Error en validación triple: ${error.message}`);
      
      // Fallback a validación dual si triple falla
      if (modelConfig.validation.triple.fallbackStrategy === 'dual') {
        this.logger.warn('🔄 Fallback a validación dual');
        return await this.evaluateWithDualValidation(
          chunkedDocument,
          prompt,
          expectedType,
          additionalContext,
          pmcField
        );
      }
      
      throw error;
    }
  }

  /**
   * GPT-4o actúa como árbitro entre las respuestas de GPT y Claude
   * @param gptResult Resultado de GPT-4o
   * @param claudeResult Resultado de Claude Sonnet 4
   * @param originalPrompt Pregunta original
   * @param expectedType Tipo esperado
   * @param documentSnippet Fragmento del documento para contexto
   * @param pmcField Campo PMC
   */
  private async arbitrateWithGPT4o(
    gptResult: { response: string; confidence: number; tokens_used: number },
    claudeResult: { response: string; confidence: number; tokens_used: number },
    originalPrompt: string,
    expectedType: ResponseType,
    documentSnippet: string,
    pmcField?: string
  ): Promise<EvaluationResult> {
    const startTime = Date.now();
    this.logger.log(`⚖️ Iniciando arbitraje para ${pmcField || 'campo'}`);

    // Calcular nivel de acuerdo inicial
    const initialAgreement = this.calculateAgreement(gptResult.response, claudeResult.response, expectedType);
    
    // Si hay consenso alto, no necesitamos árbitro
    if (initialAgreement >= modelConfig.validation.triple.highAgreementThreshold) {
      this.logger.log(`✅ Consenso alto (${(initialAgreement * 100).toFixed(0)}%) - usando respuesta consensuada`);
      
      const avgConfidence = (gptResult.confidence + claudeResult.confidence) / 2;
      
      return {
        response: gptResult.response, // Usar respuesta de GPT por defecto en consenso
        confidence: avgConfidence,
        validation_response: claudeResult.response,
        validation_confidence: claudeResult.confidence,
        final_confidence: Math.min(avgConfidence * 1.1, 1.0), // Boost por consenso
        openai_metadata: {
          validation_strategy: 'triple_consensus',
          primary_model: modelConfig.validation.triple.models.primary,
          independent_model: modelConfig.validation.triple.models.independent,
          arbitrator_model: 'not_needed',
          consensus_level: initialAgreement,
          primary_tokens: gptResult.tokens_used,
          claude_tokens: claudeResult.tokens_used,
          arbitration_tokens: 0,
          decision_reasoning: 'High consensus between models'
        }
      };
    }

    // Necesitamos arbitraje
    const arbitrationPrompt = `You are an expert arbitrator comparing two AI analyses of a document.

ORIGINAL QUESTION: ${originalPrompt}

ANALYSIS 1 (GPT-4o with chunking):
- Response: ${gptResult.response}
- Confidence: ${gptResult.confidence}
- Method: Intelligent chunking to focus on relevant sections

ANALYSIS 2 (Claude Sonnet 4 with full context):
- Response: ${claudeResult.response}
- Confidence: ${claudeResult.confidence}
- Method: Full document analysis with 200K token context

DOCUMENT SNIPPET FOR REFERENCE:
${documentSnippet.substring(0, 2000)}

Your task:
1. Compare both responses critically
2. Determine which is more accurate based on the document evidence
3. Provide a final answer with reasoning
4. Calculate agreement level (0.0 to 1.0)

Expected response type: ${expectedType}

Respond in this JSON format:
{
  "final_answer": "your definitive answer",
  "reasoning": "brief explanation of your decision",
  "selected_model": "GPT" or "CLAUDE" or "COMBINED",
  "agreement_level": 0.0 to 1.0,
  "confidence": 0.0 to 1.0
}`;

    try {
      const completion = await this.rateLimiter.executeWithRateLimit(
        async () => {
          return await this.openai.chat.completions.create({
            model: modelConfig.validation.triple.models.arbitrator,
            messages: [
              { 
                role: 'system', 
                content: 'You are an expert arbitrator. Analyze both responses and provide the most accurate answer. Respond only with valid JSON.'
              },
              { role: 'user', content: arbitrationPrompt }
            ],
            // temperature: 1, // GPT-5: Only default value (1) supported - removed parameter // Baja temperatura para decisiones consistentes
            max_completion_tokens: 500,
            response_format: { type: "json_object" }
          });
        },
        `arbitrate_${pmcField || 'field'}`,
        'high'
      );

      // Manejo robusto de respuesta JSON de GPT-5 arbitraje
      const rawArbitrationResponse = completion.choices[0].message.content?.trim() || '';
      this.logger.debug(`🔍 Arbitration raw response (${rawArbitrationResponse.length} chars): ${rawArbitrationResponse.substring(0, 200)}...`);
      
      let arbitrationResponse;
      try {
        arbitrationResponse = JSON.parse(rawArbitrationResponse);
      } catch (parseError) {
        this.logger.error(`❌ Arbitration JSON parse error: ${parseError.message}`);
        this.logger.error(`📝 Arbitration raw response: ${rawArbitrationResponse}`);
        
        // Intentar extraer JSON válido
        const jsonMatch = rawArbitrationResponse.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            arbitrationResponse = JSON.parse(jsonMatch[0]);
            this.logger.log(`🔧 Recovered partial arbitration JSON`);
          } catch (retryError) {
            this.logger.error(`❌ Arbitration JSON recovery failed: ${retryError.message}`);
            throw new Error(`Arbitration response parsing failed: ${parseError.message}`);
          }
        } else {
          throw new Error(`Arbitration response parsing failed: ${parseError.message}`);
        }
      }
      
      const elapsedTime = Date.now() - startTime;
      this.logger.log(`⚖️ Arbitraje completado en ${elapsedTime}ms - Decisión: ${arbitrationResponse.selected_model}`);

      // Determinar respuesta final basada en arbitraje
      let finalResponse: string;
      let finalConfidence: number;

      if (arbitrationResponse.selected_model === 'GPT') {
        finalResponse = gptResult.response;
        finalConfidence = gptResult.confidence;
      } else if (arbitrationResponse.selected_model === 'CLAUDE') {
        finalResponse = claudeResult.response;
        finalConfidence = claudeResult.confidence;
      } else {
        // COMBINED o nueva respuesta del árbitro
        finalResponse = arbitrationResponse.final_answer;
        finalConfidence = arbitrationResponse.confidence;
      }

      return {
        response: finalResponse,
        confidence: finalConfidence,
        validation_response: arbitrationResponse.final_answer,
        validation_confidence: arbitrationResponse.confidence,
        final_confidence: arbitrationResponse.confidence,
        openai_metadata: {
          validation_strategy: 'triple_arbitrated',
          primary_model: modelConfig.validation.triple.models.primary,
          independent_model: modelConfig.validation.triple.models.independent,
          arbitrator_model: modelConfig.validation.triple.models.arbitrator,
          consensus_level: arbitrationResponse.agreement_level,
          primary_tokens: gptResult.tokens_used,
          claude_tokens: claudeResult.tokens_used,
          arbitration_tokens: completion.usage?.total_tokens || 0,
          decision_reasoning: arbitrationResponse.reasoning,
          selected_model: arbitrationResponse.selected_model,
          gpt_response: gptResult.response,
          claude_response: claudeResult.response
        }
      };

    } catch (error) {
      this.logger.error(`Error en arbitraje: ${error.message}`);
      
      // En caso de error, usar el resultado con mayor confianza
      const bestResult = gptResult.confidence >= claudeResult.confidence ? gptResult : claudeResult;
      
      return {
        response: bestResult.response,
        confidence: bestResult.confidence,
        validation_response: bestResult.response,
        validation_confidence: bestResult.confidence,
        final_confidence: bestResult.confidence,
        openai_metadata: {
          validation_strategy: 'triple_fallback',
          primary_model: modelConfig.validation.triple.models.primary,
          independent_model: modelConfig.validation.triple.models.independent,
          arbitrator_model: 'failed',
          consensus_level: initialAgreement,
          primary_tokens: gptResult.tokens_used,
          claude_tokens: claudeResult.tokens_used,
          arbitration_tokens: 0,
          decision_reasoning: 'Arbitration failed - using highest confidence result',
          error: error.message
        }
      };
    }
  }

  /**
   * Calcula el nivel de acuerdo entre dos respuestas
   * @param response1 Primera respuesta
   * @param response2 Segunda respuesta
   * @param expectedType Tipo de respuesta esperada
   */
  private calculateAgreement(response1: string, response2: string, expectedType: ResponseType): number {
    // Normalizar respuestas para comparación
    const norm1 = response1.toLowerCase().trim();
    const norm2 = response2.toLowerCase().trim();

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
   * Obtiene estadísticas del rate limiter de Claude para debugging
   */
  getClaudeRateLimiterStats() {
    return this.claudeRateLimiter.getStats();
  }

  /**
   * Imprime estadísticas del rate limiter de Claude
   */
  logClaudeStats(): void {
    this.claudeRateLimiter.logStats();
  }

  /**
   * Resetea el rate limiter de Claude
   */
  resetClaudeRateLimiter(): void {
    this.claudeRateLimiter.reset();
    this.logger.log('🔄 Claude rate limiter has been reset');
  }

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
      this.logger.log(`🚀 === NUEVA ARQUITECTURA ACTIVADA ===`);
      this.logger.log(`📄 Documento: ${documentText.length} chars, Campo: ${pmcField}`);
      
      // 1. Enhanced Chunking para documentos grandes
      let processedContent = documentText;
      let chunkMetadata = null;
      
      // Si el documento es muy grande, usar enhanced chunking
      if (documentText.length > 400 * 1024) { // >400KB (aproximadamente 100K tokens)
        this.logger.log('📦 Documento grande detectado, usando enhanced chunking...');
        
        const chunkResult = await this.enhancedChunking!.processDocument(
          documentText,
          pmcField || 'unknown',
          { id: pmcField || 'unknown', size: documentText.length, type: 'pdf' }
        );
        
        this.logger.log(`📊 Chunking: ${chunkResult.totalChunks} chunks, estrategia: ${chunkResult.strategy}`);
        
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
        
        this.logger.log(`✂️ Contenido reducido de ${documentText.length} a ${processedContent.length} chars`);
      }
      
      // 2. Evaluación dual: GPT-5 + Gemini
      this.logger.log('🤖 Iniciando evaluación dual: GPT-5 + Gemini...');
      
      const [gpt5Result, geminiResult] = await Promise.allSettled([
        this.evaluateWithGPT5(processedContent, prompt, expectedType, additionalContext),
        this.geminiService!.evaluateDocument(processedContent, prompt, expectedType, additionalContext, pmcField)
      ]);
      
      // 3. Procesar resultados
      let primaryResult, secondaryResult;
      
      if (gpt5Result.status === 'fulfilled') {
        primaryResult = gpt5Result.value;
        this.logger.log(`✅ GPT-5: confidence ${primaryResult.confidence}`);
      } else {
        this.logger.error(`❌ GPT-5 failed: ${gpt5Result.reason?.message}`);
      }
      
      if (geminiResult.status === 'fulfilled') {
        secondaryResult = geminiResult.value;
        this.logger.log(`✅ Gemini: confidence ${secondaryResult.confidence}`);
      } else {
        // Check if Gemini is intentionally disabled vs. actual error
        const errorMsg = geminiResult.reason?.message || '';
        const isIntentionallyDisabled = errorMsg.includes('no está disponible') || errorMsg.includes('está deshabilitado');
        
        if (isIntentionallyDisabled) {
          this.logger.debug(`🔕 Gemini intencionalmente deshabilitado: ${errorMsg}`);
        } else {
          this.logger.error(`❌ Gemini failed: ${errorMsg}`);
        }
      }
      
      // 4. Análisis de consenso
      if (primaryResult && secondaryResult) {
        const agreement = this.calculateNewAgreement(primaryResult.response, secondaryResult.response);
        this.logger.log(`🤝 Acuerdo entre modelos: ${(agreement * 100).toFixed(1)}%`);
        
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
          this.logger.warn(`⚖️ Bajo consenso, invocando juez GPT-5...`);
          
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
      
      if (modelConfig.migration.allowFallbackToOldSystem) {
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
      if (modelConfig.migration.allowFallbackToOldSystem) {
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
   * Evalúa usando GPT-5 (placeholder - necesitará actualizar cuando GPT-5 esté disponible)
   */
  private async evaluateWithGPT5(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string
  ): Promise<any> {
    // Por ahora usar GPT-4o con configuración optimizada para simular GPT-5
    // TODO: Reemplazar con GPT-5 real cuando esté disponible
    
    const systemPrompt = this.buildGPT5SystemPrompt(expectedType);
    const fullPrompt = this.buildFullPrompt(systemPrompt, documentText, prompt, additionalContext);
    
    const response = await this.openai.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullPrompt }
      ],
      // temperature: 1 // GPT-5: Only default value (1) supported - removed parameter GPT-5 optimized for analytical tasks
      max_completion_tokens: 2000,
      reasoning_effort: "high", // GPT-5: deep analysis for complex documents
      response_format: { type: 'json_object' }
    });
    
    // Manejo robusto de respuesta JSON
    const rawContent = response.choices[0].message.content?.trim() || '';
    let result;
    try {
      result = JSON.parse(rawContent);
    } catch (parseError) {
      this.logger.error(`❌ JSON parse error in evaluateComplexDocumentWithGPT5: ${parseError.message}`);
      this.logger.error(`📝 Raw content: ${rawContent}`);
      throw new Error(`GPT-5 response parsing failed: ${parseError.message}`);
    }
    
    return {
      response: result.response || result.answer || 'No response',
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning || 'GPT-5 reasoning',
      model: 'gpt-5'
    };
  }

  /**
   * Invoca GPT-5 como juez árbitro
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

    const response = await this.openai.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { 
          role: 'system', 
          content: 'You are an expert arbitrator for insurance underwriting decisions.' 
        },
        { role: 'user', content: judgePrompt }
      ],
      // temperature: 1, // GPT-5: Only default value (1) supported - removed parameter
      max_completion_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    // Manejo robusto de respuesta JSON del juez final
    const rawJudgeContent = response.choices[0].message.content?.trim() || '';
    try {
      return JSON.parse(rawJudgeContent);
    } catch (parseError) {
      this.logger.error(`❌ Final judge JSON parse error: ${parseError.message}`);
      this.logger.error(`📝 Final judge raw content: ${rawJudgeContent}`);
      throw new Error(`Final judge response parsing failed: ${parseError.message}`);
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
- For dates, always convert to YYYY-MM-DD format unless specified otherwise
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
    return response
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}