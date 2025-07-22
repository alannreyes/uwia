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

      // Verificar tamaño del texto
      if (documentText.length > openaiConfig.maxTextLength) {
        this.logger.warn(`Texto excede el límite de ${openaiConfig.maxTextLength} caracteres`);
        if (openaiConfig.fallbackToLocal) {
          throw new Error('Texto muy largo, se requiere procesamiento local');
        }
        throw new Error(`El texto excede el límite máximo de ${openaiConfig.maxTextLength} caracteres`);
      }

      // Primera evaluación
      const primaryResult = await this.evaluatePrompt(documentText, prompt, expectedType, additionalContext);
      
      // Segunda evaluación (validación)
      const validationResult = await this.validateResponse(
        documentText, 
        prompt, 
        primaryResult.response, 
        expectedType,
        additionalContext
      );

      // Calcular confianza final
      const finalConfidence = this.calculateFinalConfidence(
        primaryResult.confidence,
        validationResult.confidence
      );

      return {
        response: primaryResult.response,
        confidence: primaryResult.confidence,
        validation_response: validationResult.response,
        validation_confidence: validationResult.confidence,
        final_confidence: finalConfidence,
        openai_metadata: {
          primary_model: openaiConfig.model,
          validation_model: openaiConfig.model,
          primary_tokens: primaryResult.tokens_used,
          validation_tokens: validationResult.tokens_used,
        }
      };
    } catch (error) {
      this.logger.error(`Error en evaluación con validación: ${error.message}`);
      throw error;
    }
  }

  private async evaluatePrompt(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string
  ): Promise<{ response: string; confidence: number; tokens_used: number }> {
    const systemPrompt = this.buildSystemPrompt(expectedType, additionalContext);
    const userPrompt = this.buildUserPrompt(documentText, prompt);

    const completion = await this.openai.chat.completions.create({
      model: openaiConfig.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: openaiConfig.temperature,
      max_tokens: openaiConfig.maxTokens,
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

  private async validateResponse(
    documentText: string,
    originalPrompt: string,
    originalResponse: string,
    expectedType: ResponseType,
    additionalContext?: string
  ): Promise<{ response: string; confidence: number; tokens_used: number }> {
    const validationPrompt = this.buildValidationPrompt(originalPrompt, originalResponse, expectedType);
    const systemPrompt = this.buildSystemPrompt(expectedType, additionalContext, true);
    const userPrompt = this.buildUserPrompt(documentText, validationPrompt);

    const completion = await this.openai.chat.completions.create({
      model: openaiConfig.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: openaiConfig.temperature,
      max_tokens: openaiConfig.maxTokens,
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
        basePrompt += `- Respond with ONLY "yes" or "no" (lowercase)
- Include confidence level: [CONFIDENCE: 0.XX] at the end`;
        break;
      case ResponseType.DATE:
        basePrompt += `- Respond with date in MM-DD-YYYY format only
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
        const boolMatch = cleanResponse.toLowerCase();
        if (boolMatch.includes('yes')) return 'yes';
        if (boolMatch.includes('no')) return 'no';
        return cleanResponse.toLowerCase();
      
      case ResponseType.DATE:
        const dateMatch = cleanResponse.match(/\d{2}-\d{2}-\d{4}/);
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
}