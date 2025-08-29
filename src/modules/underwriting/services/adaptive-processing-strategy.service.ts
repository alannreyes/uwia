import { Injectable, Logger } from '@nestjs/common';
import { openaiConfig } from '../../../config/openai.config';
import { ResponseType } from '../entities/uw-evaluation.entity';
import { RateLimiterService } from './rate-limiter.service';

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
  private rateLimiter: RateLimiterService;
  
  constructor() {
    this.rateLimiter = new RateLimiterService();
  }

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
  "primary_model": "gpt-5" or "gpt-4o-mini",
  "validation_model": "gpt-5" or null,
  "confidence_threshold": 0.70-0.95,
  "reasoning": "brief explanation of strategy choice"
}`;

      // Usar GPT-5 para análisis de estrategia con fallback automático
      this.logger.log(`🔧 OpenAI config check - Enabled: ${openaiConfig.enabled}, HasKey: ${!!openaiConfig.apiKey}`);
      
      if (!openaiConfig.enabled || !openaiConfig.apiKey) {
        this.logger.warn(`⚠️ OpenAI not available for strategy analysis. Enabled: ${openaiConfig.enabled}, HasKey: ${!!openaiConfig.apiKey}`);
        return this.getFallbackStrategy(pmcField, question, expectedType);
      }

      // Intentar análisis con GPT-5 con reintentos limitados - fallback rápido si falla
      const maxAttempts = 1; // Reducir a 1 intento para acelerar fallback
      let lastError = null;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const { OpenAI } = require('openai');
          const openai = new OpenAI({
            apiKey: openaiConfig.apiKey,
            timeout: openaiConfig.timeout,
            maxRetries: 1 // Solo 1 reintento por intento
          });

          // Usar rate limiter para estrategia con prioridad normal
          const completion = await this.rateLimiter.executeWithRateLimit(
            async () => {
              // Intentar con max_tokens primero (podría funcionar)
              return await openai.chat.completions.create({
                model: 'gpt-5',
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
                max_completion_tokens: 300, // CORRECTO para GPT-5
                response_format: { type: "json_object" }
              });
            },
            `strategy_${pmcField}_attempt${attempt}`,
            'normal'
          );

          // Manejo robusto de respuesta JSON de GPT-5
          const rawResponse = completion.choices[0].message.content?.trim() || '';
          
          if (!rawResponse) {
            throw new Error(`GPT-5 returned empty response on attempt ${attempt}`);
          }
          
          this.logger.debug(`🔍 GPT-5 strategy response attempt ${attempt} (${rawResponse.length} chars): ${rawResponse.substring(0, 200)}...`);
          
          let strategy;
          try {
            strategy = JSON.parse(rawResponse);
          } catch (parseError) {
            // Intentar extraer JSON válido si está parcial
            const jsonMatch = rawResponse.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
              try {
                strategy = JSON.parse(jsonMatch[0]);
                this.logger.log(`🔧 Recovered partial JSON for ${pmcField} on attempt ${attempt}`);
              } catch (retryError) {
                throw new Error(`JSON recovery failed on attempt ${attempt}: ${retryError.message}`);
              }
            } else {
              throw new Error(`No valid JSON found on attempt ${attempt}`);
            }
          }
          
          // Si llegamos aquí, el análisis fue exitoso
          const result: ProcessingStrategy = {
            useVisualAnalysis: strategy.use_visual && documentHasImages,
            useDualValidation: strategy.use_dual_validation,
            primaryModel: strategy.primary_model || process.env.OPENAI_MODEL || 'gpt-5',
            validationModel: strategy.use_dual_validation ? (strategy.validation_model || 'gpt-5') : undefined,
            confidenceThreshold: strategy.confidence_threshold || 0.85,
            reasoning: strategy.reasoning || 'AI-determined strategy'
          };

          this.logger.log(`✅ Strategy for ${pmcField}: Visual=${result.useVisualAnalysis}, Dual=${result.useDualValidation}, Model=${result.primaryModel}, Threshold=${result.confidenceThreshold}`);
          
          return result;
          
        } catch (error) {
          lastError = error;
          this.logger.warn(`⚠️ Strategy analysis attempt ${attempt}/${maxAttempts} failed for ${pmcField}: ${error.message}`);
          
          if (attempt === maxAttempts) {
            this.logger.warn(`⚠️ Strategy analysis failed for ${pmcField} (${error.message}), using proven fallback`);
          }
        }
      }
      
      // Si todos los intentos fallan, usar fallback
      this.logger.log(`🔧 Using proven fallback strategy for ${pmcField} after ${maxAttempts} failed attempts`);
      return this.getFallbackStrategy(pmcField, question, expectedType);

    } catch (error) {
      this.logger.error(`Error determining strategy for ${pmcField}: ${error.message}`);
      
      // Si el error es de rate limiting o circuit breaker, forzar fallback visual para campos críticos
      const isRateLimitError = error.message.includes('Rate limiter') || 
                              error.message.includes('Circuit breaker') ||
                              error.message.includes('queue is full');
      
      if (isRateLimitError && (pmcField.toLowerCase().includes('sign') || question.toLowerCase().includes('sign'))) {
        this.logger.warn(`🔄 Rate limit detected for signature field ${pmcField} - forcing visual analysis fallback`);
        return {
          useVisualAnalysis: true,
          useDualValidation: false, // Reducir carga
          primaryModel: 'gpt-5',
          confidenceThreshold: 0.70,
          reasoning: 'Rate limit fallback - visual analysis for signatures'
        };
      }
      
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
    
    // Detectar necesidad de análisis visual - MEJORADO para campos de firma
    const visualKeywords = [
      'sign', 'signature', 'initial', 'stamp', 'seal', 'mark', 
      'handwrit', 'visual', 'check', 'box', 'x mark', 'drawn'
    ];
    
    // Patrones específicos para campos de firma LOP
    const signaturePatterns = [
      /lop.*sign/i,           // lop_signed_by_ho1, lop_signed_by_client1
      /signed.*by/i,          // signed_by_ho, signed_by_client
      /sign.*insured/i,       // signed_insured_next_amount
      /homeowner.*sign/i,     // homeowner signature
      /client.*sign/i         // client signature
    ];
    
    const needsVisual = visualKeywords.some(keyword => 
      fieldLower.includes(keyword) || questionLower.includes(keyword)
    ) || signaturePatterns.some(pattern =>
      pattern.test(fieldLower) || pattern.test(questionLower)
    );
    
    this.logger.log(`🔍 Fallback analysis for ${pmcField}: needsVisual=${needsVisual}`);

    // Detectar necesidad de validación dual
    const complexKeywords = [
      'determine', 'analyze', 'assess', 'evaluate', 'compare',
      'match', 'verify', 'confirm', 'validate', 'cover'
    ];
    const needsDual = complexKeywords.some(keyword => 
      questionLower.includes(keyword)
    ) || expectedType === ResponseType.BOOLEAN;

    // Selección de modelo basada en complejidad
    // Usar siempre el modelo configurado en variables de entorno
    const configuredModel = process.env.OPENAI_MODEL || 'gpt-4o';
    const primaryModel = needsVisual || needsDual ? 'gpt-4o' : configuredModel;
    
    const strategy: ProcessingStrategy = {
      useVisualAnalysis: needsVisual,
      useDualValidation: needsDual,
      primaryModel,
      validationModel: needsDual ? 'gpt-4o' : undefined,
      confidenceThreshold: needsVisual ? 0.70 : (needsDual ? 0.80 : 0.90),
      reasoning: 'Fallback heuristic strategy - AI analysis unavailable'
    };

    this.logger.warn(`⚠️ Fallback strategy for ${pmcField}: Visual=${strategy.useVisualAnalysis}, Dual=${strategy.useDualValidation}, Model=${strategy.primaryModel}`);
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
    if (actualConfidence < 0.6 && originalStrategy.useVisualAnalysis && originalStrategy.primaryModel !== 'gpt-5') {
      this.logger.log(`🔄 Very low confidence (${actualConfidence}) for visual field ${pmcField} - upgrading to gpt-5`);
      
      return {
        ...originalStrategy,
        primaryModel: 'gpt-5',
        reasoning: `${originalStrategy.reasoning} + Upgraded to gpt-5 for better visual analysis`
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