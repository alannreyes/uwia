import { Injectable, Logger } from '@nestjs/common';
import { openaiConfig } from '../../../config/openai.config';
import { ResponseType } from '../entities/uw-evaluation.entity';

const { OpenAI } = require('openai');

export interface JudgeDecision {
  finalAnswer: string;
  confidence: number;
  reasoning: string;
  selectedModel: 'primary' | 'validation' | 'synthesized';
  discrepancyAnalysis?: string;
}

@Injectable()
export class JudgeValidatorService {
  private readonly logger = new Logger(JudgeValidatorService.name);
  private openai: any;

  constructor() {
    if (openaiConfig.enabled && openaiConfig.apiKey) {
      this.openai = new OpenAI({
        apiKey: openaiConfig.apiKey,
        timeout: openaiConfig.timeout,
        maxRetries: openaiConfig.maxRetries,
      });
    }
  }

  /**
   * Sistema de Juez Inteligente que analiza discrepancias y toma decisiones informadas
   */
  async judgeResponses(
    documentContext: string,
    originalQuestion: string,
    primaryAnswer: { response: string; confidence: number; model: string },
    validationAnswer: { response: string; confidence: number; model: string },
    expectedType: ResponseType,
    pmcField?: string
  ): Promise<JudgeDecision> {
    
    // Si las respuestas coinciden exactamente, alta confianza
    if (this.normalizeAnswer(primaryAnswer.response, expectedType) === 
        this.normalizeAnswer(validationAnswer.response, expectedType)) {
      
      const avgConfidence = (primaryAnswer.confidence + validationAnswer.confidence) / 2;
      
      return {
        finalAnswer: primaryAnswer.response,
        confidence: Math.min(0.99, avgConfidence + 0.15), // Bonus mayor por consenso total
        reasoning: 'Both models reached the same conclusion independently',
        selectedModel: 'primary'
      };
    }

    // Si hay discrepancia, usar un tercer modelo como juez
    this.logger.warn(`⚖️ Discrepancy detected for ${pmcField}. Invoking judge...`);
    
    try {
      const judgePrompt = this.buildJudgePrompt(
        documentContext,
        originalQuestion,
        primaryAnswer,
        validationAnswer,
        expectedType,
        pmcField
      );

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o', // Usar el modelo más capaz como juez
        messages: [
          { 
            role: 'system', 
            content: this.getJudgeSystemPrompt(expectedType) 
          },
          { 
            role: 'user', 
            content: judgePrompt 
          }
        ],
        temperature: 0.1, // Muy baja para consistencia
        max_tokens: 500,
        response_format: { type: "json_object" }
      });

      const judgeResponse = JSON.parse(completion.choices[0].message.content.trim());
      
      this.logger.log(`⚖️ Judge decision: ${judgeResponse.decision} - ${judgeResponse.reasoning}`);

      return this.processJudgeDecision(
        judgeResponse,
        primaryAnswer,
        validationAnswer,
        expectedType
      );

    } catch (error) {
      this.logger.error(`Judge error: ${error.message}`);
      // Fallback: usar el de mayor confianza
      return this.fallbackDecision(primaryAnswer, validationAnswer, expectedType);
    }
  }

  private buildJudgePrompt(
    documentContext: string,
    originalQuestion: string,
    primaryAnswer: { response: string; confidence: number; model: string },
    validationAnswer: { response: string; confidence: number; model: string },
    expectedType: ResponseType,
    pmcField?: string
  ): string {
    
    // Limitar contexto para no exceder tokens
    const limitedContext = documentContext.substring(0, 3000);
    
    return `As an expert judge, analyze these two different answers to the same question and determine the correct one.

DOCUMENT CONTEXT (excerpt):
${limitedContext}

ORIGINAL QUESTION:
${originalQuestion}

FIELD BEING EVALUATED: ${pmcField || 'unknown'}
EXPECTED ANSWER TYPE: ${expectedType}

MODEL A (${primaryAnswer.model}) ANSWER:
Response: ${primaryAnswer.response}
Confidence: ${primaryAnswer.confidence}

MODEL B (${validationAnswer.model}) ANSWER:
Response: ${validationAnswer.response}
Confidence: ${validationAnswer.confidence}

Analyze both answers considering:
1. Which answer is factually correct based on the document?
2. Which answer better addresses the specific question asked?
3. Are there any obvious errors or misinterpretations?
4. For signature/visual questions: which model likely had better visual analysis?

Respond in JSON format:
{
  "decision": "A" or "B" or "SYNTHESIZE",
  "correct_answer": "the actual correct answer",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of your decision",
  "discrepancy_analysis": "why the models disagreed"
}`;
  }

  private getJudgeSystemPrompt(expectedType: ResponseType): string {
    return `You are an expert judge specializing in document analysis and underwriting.
Your role is to resolve discrepancies between two AI models by determining the correct answer.

Key responsibilities:
1. Analyze the document context carefully
2. Identify which model provided the factually correct answer
3. If both are partially correct, synthesize a better answer
4. Provide clear reasoning for your decision

Expected response type: ${expectedType}
- For BOOLEAN: Answer must be YES or NO
- For DATE: Answer must be in MM-DD-YY format
- For TEXT: Provide the most accurate text response
- For NUMBER: Provide the correct numeric value

Be decisive and accurate. Your judgment is final.`;
  }

  private processJudgeDecision(
    judgeResponse: any,
    primaryAnswer: { response: string; confidence: number },
    validationAnswer: { response: string; confidence: number },
    expectedType: ResponseType
  ): JudgeDecision {
    
    let finalAnswer: string;
    let selectedModel: 'primary' | 'validation' | 'synthesized';
    
    if (judgeResponse.decision === 'A') {
      finalAnswer = primaryAnswer.response;
      selectedModel = 'primary';
    } else if (judgeResponse.decision === 'B') {
      finalAnswer = validationAnswer.response;
      selectedModel = 'validation';
    } else {
      // Judge synthesized a new answer
      finalAnswer = this.formatAnswer(judgeResponse.correct_answer, expectedType);
      selectedModel = 'synthesized';
    }

    return {
      finalAnswer,
      confidence: judgeResponse.confidence || 0.85,
      reasoning: judgeResponse.reasoning,
      selectedModel,
      discrepancyAnalysis: judgeResponse.discrepancy_analysis
    };
  }

  private fallbackDecision(
    primaryAnswer: { response: string; confidence: number },
    validationAnswer: { response: string; confidence: number },
    expectedType: ResponseType
  ): JudgeDecision {
    
    const useValidation = validationAnswer.confidence > primaryAnswer.confidence;
    
    return {
      finalAnswer: useValidation ? validationAnswer.response : primaryAnswer.response,
      confidence: Math.max(primaryAnswer.confidence, validationAnswer.confidence) * 0.8,
      reasoning: 'Fallback: selected answer with higher confidence',
      selectedModel: useValidation ? 'validation' : 'primary',
      discrepancyAnalysis: 'Judge unavailable - used confidence-based selection'
    };
  }

  private normalizeAnswer(answer: string, expectedType: ResponseType): string {
    switch (expectedType) {
      case ResponseType.BOOLEAN:
        return answer.toUpperCase().includes('YES') ? 'YES' : 'NO';
      
      case ResponseType.DATE:
        // Extraer solo la fecha sin formato
        const dateMatch = answer.match(/\d{2}[-\/]\d{2}[-\/]\d{2,4}/);
        return dateMatch ? dateMatch[0] : answer;
      
      case ResponseType.NUMBER:
        const numMatch = answer.match(/\d+\.?\d*/);
        return numMatch ? numMatch[0] : answer;
      
      default:
        return answer.toLowerCase().trim();
    }
  }

  private formatAnswer(answer: string, expectedType: ResponseType): string {
    switch (expectedType) {
      case ResponseType.BOOLEAN:
        return answer.toUpperCase().includes('YES') ? 'YES' : 'NO';
      
      case ResponseType.DATE:
        // Convertir a formato MM-DD-YY si es necesario
        return this.convertToDateFormat(answer);
      
      case ResponseType.NUMBER:
        const num = parseFloat(answer);
        return isNaN(num) ? answer : num.toString();
      
      default:
        return answer;
    }
  }

  private convertToDateFormat(dateStr: string): string {
    // Implementar conversión de fecha si es necesario
    const patterns = [
      /(\d{2})[-\/](\d{2})[-\/](\d{2})/, // MM-DD-YY
      /(\d{4})[-\/](\d{2})[-\/](\d{2})/, // YYYY-MM-DD
      /(\d{2})[-\/](\d{2})[-\/](\d{4})/, // MM-DD-YYYY
    ];
    
    for (const pattern of patterns) {
      const match = dateStr.match(pattern);
      if (match) {
        if (match[1].length === 4) {
          // YYYY-MM-DD -> MM-DD-YY
          return `${match[2]}-${match[3]}-${match[1].slice(-2)}`;
        } else if (match[3].length === 4) {
          // MM-DD-YYYY -> MM-DD-YY
          return `${match[1]}-${match[2]}-${match[3].slice(-2)}`;
        } else {
          // Ya está en MM-DD-YY
          return `${match[1]}-${match[2]}-${match[3]}`;
        }
      }
    }
    
    return dateStr;
  }

  /**
   * Análisis de patrones de error para mejorar el sistema
   */
  async analyzeErrorPatterns(
    discrepancies: Array<{
      field: string;
      primaryAnswer: string;
      validationAnswer: string;
      judgeDecision: string;
    }>
  ): Promise<{
    patterns: string[];
    recommendations: string[];
  }> {
    
    const patterns: string[] = [];
    const fieldTypes = new Map<string, number>();
    
    for (const disc of discrepancies) {
      // Contar tipos de campos con más errores
      const fieldType = this.getFieldType(disc.field);
      fieldTypes.set(fieldType, (fieldTypes.get(fieldType) || 0) + 1);
    }
    
    // Identificar patrones
    fieldTypes.forEach((count, type) => {
      if (count > 2) {
        patterns.push(`High discrepancy rate in ${type} fields (${count} cases)`);
      }
    });
    
    // Generar recomendaciones
    const recommendations: string[] = [];
    if (patterns.some(p => p.includes('signature'))) {
      recommendations.push('Consider always using Vision API for signature fields');
    }
    if (patterns.some(p => p.includes('date'))) {
      recommendations.push('Review date extraction prompts for clarity');
    }
    
    return { patterns, recommendations };
  }

  private getFieldType(field: string): string {
    const lower = field.toLowerCase();
    if (lower.includes('sign')) return 'signature';
    if (lower.includes('date')) return 'date';
    if (lower.includes('amount') || lower.includes('number')) return 'numeric';
    if (lower.includes('address') || lower.includes('street')) return 'address';
    return 'other';
  }
}