import { Injectable, Logger } from '@nestjs/common';
import { openaiConfig } from '../../../config/openai.config';
import { ResponseType } from '../entities/uw-evaluation.entity';

export interface ProcessingStrategy {
  useVisualAnalysis: boolean;
  useDualValidation: boolean;
  primaryModel: string;
  validationModel?: string;
  confidenceThreshold: number;
  reasoning: string;
}

@Injectable()
export class AdaptiveProcessingStrategyService {
  private readonly logger = new Logger(AdaptiveProcessingStrategyService.name);

  /**
   * Determina la estrategia de procesamiento más adecuada para cada prompt
   * Se adapta dinámicamente al contenido sin depender de campos hardcodeados
   */
  async determineStrategy(
    pmcField: string,
    question: string,
    expectedType: ResponseType,
    documentHasImages: boolean = true
  ): Promise<ProcessingStrategy> {
    
    try {
      // Análisis semántico del prompt para determinar estrategia
      const analysisPrompt = `Analyze this document processing question and determine the optimal AI strategy.

Field Name: ${pmcField}
Question: ${question}
Expected Type: ${expectedType}
Document has images: ${documentHasImages}

Determine the strategy based on these criteria:

VISUAL ANALYSIS NEEDED if:
- Question asks about visual elements (signatures, stamps, marks, handwriting)
- Question requires spatial analysis (layout, positioning, proximity)
- Question asks about presence/absence of visual items
- Question requires reading handwritten content
- Question mentions visual verification

DUAL VALIDATION NEEDED if:
- Question is complex or subjective (HIGH priority)
- Question requires legal/business judgment
- Question has high business impact
- Expected answer type is boolean with subjective criteria
- Question requires interpretation rather than extraction

MODEL SELECTION:
- Use gpt-4o for complex analysis, legal questions, or visual tasks
- Use gpt-4o-mini for simple data extraction
- Always use gpt-4o for validation when dual validation is needed

CONFIDENCE THRESHOLD:
- 0.95 for simple data extraction
- 0.85 for complex analysis
- 0.70 for highly subjective questions

Respond in JSON format:
{
  "use_visual": true/false,
  "use_dual_validation": true/false,
  "primary_model": "gpt-4o" or "gpt-4o-mini",
  "validation_model": "gpt-4o" or null,
  "confidence_threshold": 0.70-0.95,
  "reasoning": "brief explanation of strategy choice"
}`;

      // Usar GPT-4o-mini para análisis de estrategia (rápido y económico)
      if (!openaiConfig.enabled || !openaiConfig.apiKey) {
        return this.getFallbackStrategy(pmcField, question, expectedType);
      }

      const { OpenAI } = require('openai');
      const openai = new OpenAI({
        apiKey: openaiConfig.apiKey,
        timeout: openaiConfig.timeout,
        maxRetries: 2
      });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an AI strategy expert. Analyze document processing requirements and recommend optimal AI strategies. Respond only with valid JSON.'
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" }
      });

      const strategy = JSON.parse(completion.choices[0].message.content.trim());
      
      const result: ProcessingStrategy = {
        useVisualAnalysis: strategy.use_visual && documentHasImages,
        useDualValidation: strategy.use_dual_validation,
        primaryModel: strategy.primary_model || 'gpt-4o-mini',
        validationModel: strategy.use_dual_validation ? (strategy.validation_model || 'gpt-4o') : undefined,
        confidenceThreshold: strategy.confidence_threshold || 0.85,
        reasoning: strategy.reasoning || 'AI-determined strategy'
      };

      this.logger.log(`🎯 Strategy for ${pmcField}: Visual=${result.useVisualAnalysis}, Dual=${result.useDualValidation}, Model=${result.primaryModel}, Threshold=${result.confidenceThreshold}`);
      this.logger.log(`📝 Reasoning: ${result.reasoning}`);

      return result;

    } catch (error) {
      this.logger.error(`Error determining strategy for ${pmcField}: ${error.message}`);
      return this.getFallbackStrategy(pmcField, question, expectedType);
    }
  }

  /**
   * Estrategia de fallback basada en heurísticas simples
   */
  private getFallbackStrategy(
    pmcField: string,
    question: string,
    expectedType: ResponseType
  ): ProcessingStrategy {
    
    const fieldLower = pmcField.toLowerCase();
    const questionLower = question.toLowerCase();
    
    // Detectar necesidad de análisis visual
    const visualKeywords = [
      'sign', 'signature', 'initial', 'stamp', 'seal', 'mark', 
      'handwrit', 'visual', 'check', 'box', 'x mark', 'drawn'
    ];
    const needsVisual = visualKeywords.some(keyword => 
      fieldLower.includes(keyword) || questionLower.includes(keyword)
    );

    // Detectar necesidad de validación dual
    const complexKeywords = [
      'determine', 'analyze', 'assess', 'evaluate', 'compare',
      'match', 'verify', 'confirm', 'validate', 'cover'
    ];
    const needsDual = complexKeywords.some(keyword => 
      questionLower.includes(keyword)
    ) || expectedType === ResponseType.BOOLEAN;

    // Selección de modelo basada en complejidad
    const primaryModel = needsVisual || needsDual ? 'gpt-4o' : 'gpt-4o-mini';
    
    const strategy: ProcessingStrategy = {
      useVisualAnalysis: needsVisual,
      useDualValidation: needsDual,
      primaryModel,
      validationModel: needsDual ? 'gpt-4o' : undefined,
      confidenceThreshold: needsVisual ? 0.70 : (needsDual ? 0.80 : 0.90),
      reasoning: 'Fallback heuristic strategy - AI analysis unavailable'
    };

    this.logger.warn(`⚠️ Using fallback strategy for ${pmcField}: ${JSON.stringify(strategy)}`);
    return strategy;
  }

  /**
   * Ajusta la estrategia basada en resultados de confianza
   */
  adjustStrategyBasedOnConfidence(
    originalStrategy: ProcessingStrategy,
    actualConfidence: number,
    pmcField: string
  ): ProcessingStrategy {
    
    // Si la confianza es baja y no usamos dual validation, recomendarlo
    if (actualConfidence < 0.7 && !originalStrategy.useDualValidation) {
      this.logger.log(`📈 Low confidence (${actualConfidence}) for ${pmcField} - recommending dual validation for future`);
      
      return {
        ...originalStrategy,
        useDualValidation: true,
        validationModel: 'gpt-4o',
        reasoning: `${originalStrategy.reasoning} + Auto-adjusted for low confidence`
      };
    }

    // Si la confianza es baja y es visual, sugerir cambio de modelo
    if (actualConfidence < 0.6 && originalStrategy.useVisualAnalysis && originalStrategy.primaryModel !== 'gpt-4o') {
      this.logger.log(`🔄 Very low confidence (${actualConfidence}) for visual field ${pmcField} - upgrading to gpt-4o`);
      
      return {
        ...originalStrategy,
        primaryModel: 'gpt-4o',
        reasoning: `${originalStrategy.reasoning} + Upgraded to gpt-4o for better visual analysis`
      };
    }

    return originalStrategy;
  }

  /**
   * Obtiene estadísticas de estrategias para optimización
   */
  getStrategyStats(): {
    totalAnalyzed: number;
    visualAnalysisRate: number;
    dualValidationRate: number;
    averageConfidence: number;
  } {
    // TODO: Implementar tracking de estadísticas
    return {
      totalAnalyzed: 0,
      visualAnalysisRate: 0,
      dualValidationRate: 0,
      averageConfidence: 0
    };
  }

  /**
   * Determina si un campo requiere análisis de múltiples páginas
   */
  requiresMultiPageAnalysis(question: string): boolean {
    const multiPageKeywords = [
      'throughout', 'anywhere', 'any page', 'all pages',
      'entire document', 'look for', 'search'
    ];
    
    return multiPageKeywords.some(keyword => 
      question.toLowerCase().includes(keyword)
    );
  }

  /**
   * Selecciona la mejor página para análisis visual si no se requiere análisis completo
   */
  selectOptimalPage(
    question: string,
    availablePages: number[]
  ): number[] {
    
    if (this.requiresMultiPageAnalysis(question)) {
      return availablePages; // Analizar todas las páginas
    }

    // Para firmas, privilegiar última página
    if (question.toLowerCase().includes('sign')) {
      return [Math.max(...availablePages)];
    }

    // Para información general, primera página
    return [Math.min(...availablePages)];
  }
}