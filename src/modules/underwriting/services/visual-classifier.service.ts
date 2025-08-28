import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from './openai.service';

interface ClassificationResult {
  requiresVisual: boolean;
  reason: string;
  confidence: number;
}

interface BatchClassificationRequest {
  pmcField: string;
  question: string;
}

@Injectable()
export class VisualClassifierService {
  private readonly logger = new Logger(VisualClassifierService.name);
  private classificationCache = new Map<string, ClassificationResult>();
  
  constructor(private openAiService: OpenAiService) {}

  /**
   * Pre-clasifica todos los prompts en batch para optimizar rendimiento
   */
  async classifyBatch(prompts: BatchClassificationRequest[]): Promise<Map<string, ClassificationResult>> {
    const results = new Map<string, ClassificationResult>();
    const uncachedPrompts: BatchClassificationRequest[] = [];
    
    // Revisar cache primero
    for (const prompt of prompts) {
      const cacheKey = this.getCacheKey(prompt.pmcField, prompt.question);
      if (this.classificationCache.has(cacheKey)) {
        results.set(prompt.pmcField, this.classificationCache.get(cacheKey)!);
        this.logger.log(`📦 Using cached classification for ${prompt.pmcField}`);
      } else {
        uncachedPrompts.push(prompt);
      }
    }
    
    // Si no hay prompts sin cache, retornar
    if (uncachedPrompts.length === 0) {
      return results;
    }
    
    // Clasificar en batch los no cacheados
    this.logger.log(`🤖 Classifying ${uncachedPrompts.length} prompts in batch`);
    
    try {
      const batchPrompt = this.buildBatchClassificationPrompt(uncachedPrompts);
      const response = await this.openAiService.classifyBatch(batchPrompt);
      const batchResults = JSON.parse(response);
      
      // Procesar y cachear resultados
      for (let i = 0; i < uncachedPrompts.length; i++) {
        const prompt = uncachedPrompts[i];
        const result = batchResults.classifications[i];
        
        const classification: ClassificationResult = {
          requiresVisual: result.requires_visual,
          reason: result.reason,
          confidence: result.confidence || 0.9
        };
        
        const cacheKey = this.getCacheKey(prompt.pmcField, prompt.question);
        this.classificationCache.set(cacheKey, classification);
        results.set(prompt.pmcField, classification);
        
        this.logger.log(
          `📊 ${prompt.pmcField}: ${classification.requiresVisual ? '👁️ Visual' : '📄 Text'} - ${classification.reason}`
        );
      }
      
      // Limpiar cache si crece demasiado
      if (this.classificationCache.size > 200) {
        const toDelete = this.classificationCache.size - 150;
        const keys = Array.from(this.classificationCache.keys());
        for (let i = 0; i < toDelete; i++) {
          this.classificationCache.delete(keys[i]);
        }
      }
      
    } catch (error) {
      this.logger.error(`Error in batch classification: ${error.message}`);
      // Fallback: clasificar individualmente
      for (const prompt of uncachedPrompts) {
        const classification = await this.classifySingle(prompt.pmcField, prompt.question);
        results.set(prompt.pmcField, classification);
      }
    }
    
    return results;
  }

  /**
   * Clasifica un solo prompt (fallback)
   */
  async classifySingle(pmcField: string, question: string): Promise<ClassificationResult> {
    const cacheKey = this.getCacheKey(pmcField, question);
    
    if (this.classificationCache.has(cacheKey)) {
      return this.classificationCache.get(cacheKey)!;
    }
    
    try {
      const result = await this.openAiService.classifyVisualRequirement(pmcField, question);
      
      const classification: ClassificationResult = {
        requiresVisual: result.requiresVisual,
        reason: result.reason,
        confidence: 0.9
      };
      
      this.classificationCache.set(cacheKey, classification);
      return classification;
      
    } catch (error) {
      // Fallback conservador
      this.logger.error(`Classification error for ${pmcField}: ${error.message}`);
      return {
        requiresVisual: this.fallbackClassification(pmcField, question),
        reason: 'Fallback classification due to error',
        confidence: 0.5
      };
    }
  }

  private buildBatchClassificationPrompt(prompts: BatchClassificationRequest[]): string {
    const promptList = prompts.map((p, i) => 
      `${i + 1}. Field: "${p.pmcField}", Question: "${p.question}"`
    ).join('\n');
    
    return `Analyze these document processing questions and determine which require visual inspection vs text extraction.

Visual analysis IS REQUIRED for:
- Signatures, initials, handwritten elements
- Checkboxes, stamps, seals, physical marks
- Visual verification of presence/absence
- Layout or formatting questions

Text extraction is SUFFICIENT for:
- Names, addresses, numbers, dates
- Policy details, claim information
- Any data that can be extracted via OCR

Questions to classify:
${promptList}

Respond with JSON array format:
{
  "classifications": [
    {
      "field": "field_name",
      "requires_visual": true/false,
      "reason": "brief explanation",
      "confidence": 0.0-1.0
    }
  ]
}`;
  }

  private getCacheKey(pmcField: string, question: string): string {
    return `${pmcField}__${question.substring(0, 100)}`;
  }

  private fallbackClassification(pmcField: string, question: string): boolean {
    const field = pmcField.toLowerCase();
    const q = question.toLowerCase();
    
    // Patrones que definitivamente requieren visual
    const visualPatterns = [
      /sign/i,
      /signature/i,
      /initial/i,
      /stamp/i,
      /seal/i,
      /check.*box/i,
      /mark/i,
      /handwrit/i
    ];
    
    return visualPatterns.some(pattern => 
      pattern.test(field) || pattern.test(q)
    );
  }

  /**
   * Limpia el cache completo
   */
  clearCache(): void {
    this.classificationCache.clear();
    this.logger.log('🧹 Classification cache cleared');
  }

  /**
   * Obtiene estadísticas del cache
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.classificationCache.size,
      maxSize: 200
    };
  }
}