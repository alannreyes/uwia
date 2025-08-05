import { Injectable, Logger } from '@nestjs/common';
import { openaiConfig, processingConfig } from '../../../config/openai.config';
import { ResponseType } from '../entities/uw-evaluation.entity';

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

  constructor() {
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
    additionalContext?: string
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
        return await this.evaluateWithDualValidation(relevantText, prompt, expectedType, additionalContext);
      } else {
        // Fallback a evaluación simple
        const result = await this.evaluatePrompt(relevantText, prompt, expectedType, additionalContext);
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
    modelOverride?: string
  ): Promise<{ response: string; confidence: number; tokens_used: number }> {
    const systemPrompt = this.buildSystemPrompt(expectedType, additionalContext);
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

    return {
      response: cleanResponse,
      confidence: confidence,
      tokens_used: completion.usage?.total_tokens || 0
    };
  }


  private buildSystemPrompt(expectedType: ResponseType, additionalContext?: string, isValidation = false): string {
    let basePrompt = `You are a precise document analyzer for underwriting purposes. `;
    
    if (isValidation) {
      basePrompt += `You are performing a validation check on a previous analysis. `;
    }

    basePrompt += `Your responses must be extremely accurate and reliable.

RESPONSE FORMAT REQUIREMENTS:
`;

    switch (expectedType) {
      case ResponseType.BOOLEAN:
        basePrompt += `- Respond with ONLY "YES" or "NO" (uppercase)
- Do NOT use lowercase "yes" or "no"
- Include confidence level: [CONFIDENCE: 0.XX] at the end`;
        break;
      case ResponseType.DATE:
        basePrompt += `- Respond with date in YYYY-MM-DD format only
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
        // Buscar fecha en formato YYYY-MM-DD o MM-DD-YYYY
        const dateMatch = cleanResponse.match(/\d{4}-\d{2}-\d{2}/) || cleanResponse.match(/\d{2}-\d{2}-\d{4}/);
        return dateMatch ? dateMatch[0] : cleanResponse;
      
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
    additionalContext?: string
  ): Promise<EvaluationResult> {
    this.logger.log(`🔄 Usando validación dual: ${openaiConfig.model} + ${openaiConfig.validationModel}`);

    // 1. Evaluación inicial con modelo rápido
    const primaryResult = await this.evaluatePrompt(
      documentText, 
      prompt, 
      expectedType, 
      additionalContext,
      openaiConfig.model // gpt-4o-mini
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

    // 3. Análisis de consensus
    const consensus = this.analyzeConsensus(primaryResult, validationResult, expectedType);
    
    this.logger.log(`📊 Consensus: ${consensus.agreement ? 'ACUERDO' : 'DISCREPANCIA'} - Confianza final: ${consensus.finalConfidence}`);

    return {
      response: consensus.finalResponse,
      confidence: primaryResult.confidence,
      validation_response: validationResult.response,
      validation_confidence: validationResult.confidence,
      final_confidence: consensus.finalConfidence,
      openai_metadata: {
        primary_model: openaiConfig.model,
        validation_model: openaiConfig.validationModel,
        primary_tokens: primaryResult.tokens_used,
        validation_tokens: validationResult.tokens_used,
        consensus_agreement: consensus.agreement,
        consensus_reason: consensus.reason
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
        // Extraer fecha en formato YYYY-MM-DD o MM-DD-YYYY
        const dateMatch = response.match(/\d{4}-\d{2}-\d{2}/) || response.match(/\d{2}-\d{2}-\d{4}/);
        return dateMatch ? dateMatch[0] : response.toLowerCase();
      default:
        return response.toLowerCase().trim();
    }
  }
}