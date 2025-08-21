import { Injectable, Logger } from '@nestjs/common';
import { openaiConfig, processingConfig } from '../../../config/openai.config';
import { ResponseType } from '../entities/uw-evaluation.entity';
import { JudgeValidatorService } from './judge-validator.service';

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
  private openai: any;

  constructor(private judgeValidator: JudgeValidatorService) {
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

      // Estrategia dual-model para máxima precisión
      if (openaiConfig.dualValidation) {
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

    const completion = await this.retryWithBackoff(async () => {
      return await this.openai.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: openaiConfig.temperature,
        max_tokens: openaiConfig.maxTokens,
      });
    });

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
    // Si el documento es pequeño, retornarlo completo
    if (documentText.length <= 15000) {
      return documentText;
    }

    // Dividir el documento en chunks de ~8000 caracteres
    const chunkSize = 8000;
    const overlap = 500; // Overlap para no perder contexto entre chunks
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
    
    // Tomar chunks hasta un máximo de ~25,000 caracteres
    let totalLength = 0;
    const selectedChunks: { chunk: string; index: number }[] = [];
    
    for (const item of scoredChunks) {
      if (totalLength + item.chunk.length <= 25000) {
        selectedChunks.push(item);
        totalLength += item.chunk.length;
      }
    }

    // Reordenar por índice original para mantener coherencia
    selectedChunks.sort((a, b) => a.index - b.index);
    
    // Si no hay chunks relevantes, tomar los primeros chunks
    if (selectedChunks.length === 0) {
      const firstChunks = chunks.slice(0, 3); // Primeros 3 chunks
      return firstChunks.join('\n\n--- CHUNK SEPARATOR ---\n\n');
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

  private async evaluateWithDualValidation(
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

    // 3. Análisis inteligente con juez
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

    this.logger.log(`⚖️ Judge Decision: ${judgeDecision.selectedModel} - Confianza: ${judgeDecision.confidence} - Razón: ${judgeDecision.reasoning}`);

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

    const completion = await this.retryWithBackoff(async () => {
      return await this.openai.chat.completions.create({
        model: modelToUse,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: openaiConfig.temperature,
        max_tokens: openaiConfig.maxTokens,
      });
    });

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
          model: 'gpt-4o-mini',
          messages: [
            { 
              role: 'system', 
              content: 'You are an expert at classifying document questions. Always respond with valid JSON only.' 
            },
            { role: 'user', content: batchPrompt }
          ],
          temperature: 0.1,
          max_tokens: 1000,
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
          model: 'gpt-4o-mini', // Usar modelo más rápido para clasificación
          messages: [
            { 
              role: 'system', 
              content: 'You are an expert at determining if document questions require visual analysis. Respond only with valid JSON.' 
            },
            { role: 'user', content: classificationPrompt }
          ],
          temperature: 0.1, // Baja temperatura para respuestas consistentes
          max_tokens: 150,
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
      
      const completion = await this.retryWithBackoff(async () => {
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
          max_tokens: 300,
          temperature: parseFloat(process.env.OPENAI_VISION_TEMPERATURE) || 0.1
        });
      });

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
      throw error;
    }
  }

  private buildVisionPrompt(prompt: string, expectedType: ResponseType, pmcField?: string): string {
    const typeInstructions = {
      boolean: 'Answer with ONLY "YES" or "NO".',
      date: 'Answer with ONLY the date in MM-DD-YY format.',
      text: 'Provide a brief, specific answer.',
      number: 'Answer with ONLY the numeric value.',
      json: 'Provide a valid JSON object.'
    };

    // Prompts específicos para análisis visual
    const visualHints = {
      signature: 'Look for handwritten signatures, signature lines, "X" marks, or any indication of signing.',
      stamp: 'Look for official stamps, seals, or embossed marks.',
      checkbox: 'Look for checkboxes, tickmarks, or selection indicators.',
      handwriting: 'Look for handwritten text or filled form fields.'
    };

    let hint = '';
    const lowerField = (pmcField || '').toLowerCase();
    
    if (lowerField.includes('sign')) hint = visualHints.signature;
    else if (lowerField.includes('stamp') || lowerField.includes('seal')) hint = visualHints.stamp;
    else if (lowerField.includes('check') || lowerField.includes('mark')) hint = visualHints.checkbox;
    else if (lowerField.includes('handwrit') || lowerField.includes('filled')) hint = visualHints.handwriting;

    return `You are analyzing a document image. ${hint}

QUESTION: ${prompt}

${typeInstructions[expectedType] || ''}

Important: Base your answer ONLY on what you can visually see in the image. If you cannot clearly determine the answer from the visual evidence, respond with "NO" for boolean questions or "NOT FOUND" for other types.`;
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
}