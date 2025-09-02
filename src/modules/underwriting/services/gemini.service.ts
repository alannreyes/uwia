import { Injectable, Logger } from '@nestjs/common';
import { geminiConfig, isGeminiAvailable, estimateGeminiTokens } from '../../../config/gemini.config';
import { ResponseType } from '../entities/uw-evaluation.entity';
import { GeminiRateLimiterService } from './gemini-rate-limiter.service';

// Importar Gemini SDK solo si está disponible
let GoogleGenerativeAI: any;
try {
  ({ GoogleGenerativeAI } = require('@google/generative-ai'));
} catch (error) {
  // No hacer nada si no está instalado - el servicio se deshabilitará
}

export interface GeminiEvaluationResult {
  response: string;
  confidence: number;
  reasoning?: string;
  processingTime: number;
  tokensUsed: number;
  model: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private geminiClient?: any;
  private model?: any;
  private rateLimiter: GeminiRateLimiterService;
  
  // Métricas de performance - igual que en Claude
  private performanceMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    averageLatency: 0,
    errorRate: 0,
    totalTokensUsed: 0,
  };

  constructor() {
    this.rateLimiter = new GeminiRateLimiterService();
    
    // Solo inicializar si Gemini está habilitado y disponible
    if (!isGeminiAvailable()) {
      this.logger.warn('🟡 Gemini 2.5 Pro está deshabilitado o no configurado');
      return;
    }
    
    if (!GoogleGenerativeAI) {
      this.logger.error('❌ @google/generative-ai no está instalado. Instalar con: npm install @google/generative-ai');
      return;
    }
    
    try {
      this.geminiClient = new GoogleGenerativeAI(geminiConfig.apiKey);
      this.model = this.geminiClient.getGenerativeModel({ 
        model: geminiConfig.model,
        generationConfig: {
          temperature: geminiConfig.temperature,
          maxOutputTokens: geminiConfig.maxOutputTokens,
        },
      });
      
      this.logger.log('✅ Cliente Gemini 2.5 Pro inicializado correctamente');
      this.logger.log(`📊 Contexto máximo: ${geminiConfig.maxContextTokens.toLocaleString()} tokens (2M)`);
    } catch (error) {
      this.logger.error(`❌ Error inicializando Gemini: ${error.message}`);
      this.geminiClient = null;
      this.model = null;
    }
  }

  /**
   * Evalúa un documento usando Gemini 2.5 Pro
   * Sigue la misma interfaz que el sistema existente
   */
  async evaluateDocument(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string,
    pmcField?: string
  ): Promise<GeminiEvaluationResult> {
    const startTime = Date.now();
    
    if (!this.isAvailable()) {
      throw new Error('Gemini 2.5 Pro no está disponible');
    }
    
    try {
      
      // Rate limiting - igual que Claude
      await this.rateLimiter.checkLimit('gemini-requests');
      
      // Verificar tamaño del documento
      const estimatedTokens = estimateGeminiTokens(documentText);
      if (estimatedTokens > geminiConfig.maxDocumentTokens) {
        this.logger.warn(`⚠️ Documento muy grande: ${estimatedTokens.toLocaleString()} tokens`);
        if (geminiConfig.emergencyChunking.enabled) {
          this.logger.log('🔧 Activando chunking de emergencia...');
          return await this.evaluateWithEmergencyChunking(
            documentText, 
            prompt, 
            expectedType, 
            additionalContext, 
            pmcField
          );
        }
        throw new Error(`Documento excede límite de ${geminiConfig.maxDocumentTokens.toLocaleString()} tokens`);
      }
      
      // Preparar el prompt
      const systemPrompt = this.buildSystemPrompt(expectedType);
      const fullPrompt = this.buildFullPrompt(systemPrompt, documentText, prompt, additionalContext);
      
      // Ejecutar evaluación con thinking mode si está habilitado
      let result;
      if (geminiConfig.useThinkingMode) {
        result = await this.model.generateContent(`Think step by step before answering.\n\n${fullPrompt}`);
      } else {
        result = await this.model.generateContent(fullPrompt);
      }
      
      const response = result.response;
      const text = response.text();
      
      // Parsear respuesta
      const evaluation = this.parseResponse(text, expectedType);
      
      // Calcular métricas
      const processingTime = Date.now() - startTime;
      const actualTokens = estimateGeminiTokens(documentText + fullPrompt + text);
      
      // Actualizar métricas
      this.updatePerformanceMetrics(true, processingTime, actualTokens);
      
      this.logger.log(`[${pmcField}] ✅ Gemini completed in ${processingTime}ms`);
      
      return {
        response: evaluation.response,
        confidence: evaluation.confidence,
        reasoning: evaluation.reasoning,
        processingTime,
        tokensUsed: actualTokens,
        model: 'gemini-2.5-pro'
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updatePerformanceMetrics(false, processingTime, 0);
      
      this.logger.error(`❌ Error en evaluación Gemini: ${error.message}`);
      
      // Re-throw con contexto adicional
      throw new Error(`Gemini evaluation failed: ${error.message}`);
    }
  }

  /**
   * Chunking de emergencia para documentos extremadamente grandes
   */
  private async evaluateWithEmergencyChunking(
    documentText: string,
    prompt: string,
    expectedType: ResponseType,
    additionalContext?: string,
    pmcField?: string
  ): Promise<GeminiEvaluationResult> {
    this.logger.warn('🚨 Usando chunking de emergencia para documento masivo');
    
    const chunkSize = geminiConfig.emergencyChunking.maxChunkSize * 4; // Convertir tokens a chars
    const overlapSize = geminiConfig.emergencyChunking.overlapSize * 4;
    
    const chunks = [];
    let position = 0;
    
    while (position < documentText.length) {
      const end = Math.min(position + chunkSize, documentText.length);
      chunks.push(documentText.substring(position, end));
      position = end - overlapSize;
    }
    
    this.logger.log(`📦 Documento dividido en ${chunks.length} chunks de emergencia`);
    
    // Procesar chunks secuencialmente para evitar rate limits
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      this.logger.log(`📝 Procesando chunk ${i + 1}/${chunks.length}`);
      
      try {
        const chunkResult = await this.evaluateDocument(
          chunks[i],
          prompt,
          expectedType,
          additionalContext,
          `${pmcField}-chunk-${i + 1}`
        );
        results.push(chunkResult);
        
        // Pequeña pausa entre chunks
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        this.logger.warn(`⚠️ Error en chunk ${i + 1}: ${error.message}`);
        // Continuar con otros chunks
      }
    }
    
    if (results.length === 0) {
      throw new Error('No se pudo procesar ningún chunk exitosamente');
    }
    
    // Agregar resultados
    return this.aggregateChunkResults(results);
  }

  /**
   * Construye el system prompt siguiendo el patrón del sistema existente
   */
  private buildSystemPrompt(expectedType: ResponseType): string {
    let prompt = `You are an expert insurance underwriting AI assistant powered by Gemini 2.5 Pro.
You have access to massive context (2M tokens) and advanced reasoning capabilities.

Expected response type: ${expectedType}

Instructions:
1. Analyze the entire document thoroughly using your full context window
2. Use step-by-step reasoning for complex decisions
3. Be precise and confident in your analysis
4. Focus on underwriting-relevant information

Provide your response in JSON format:
{
  "response": "your answer here",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation of your reasoning"
}`;

    // Personalizar por tipo de respuesta
    switch (expectedType) {
      case ResponseType.BOOLEAN:
        prompt += '\n\nFor boolean responses, use "Yes" or "No" only.';
        break;
      case ResponseType.NUMBER:
        prompt += '\n\nFor numeric responses, provide the exact number without formatting.';
        break;
      case 'CURRENCY' as any:
        prompt += '\n\nFor currency responses, provide the amount as a number (without currency symbols).';
        break;
      case 'PERCENTAGE' as any:
        prompt += '\n\nFor percentage responses, provide as decimal (e.g., 0.15 for 15%).';
        break;
      case ResponseType.DATE:
        prompt += '\n\nFor date responses, use MM-DD-YY format (e.g., 07-22-25).';
        break;
    }

    return prompt;
  }

  /**
   * Construye el prompt completo
   */
  private buildFullPrompt(
    systemPrompt: string,
    documentText: string,
    prompt: string,
    additionalContext?: string
  ): string {
    let fullPrompt = `${systemPrompt}\n\n`;
    
    if (additionalContext) {
      fullPrompt += `Additional Context: ${additionalContext}\n\n`;
    }
    
    fullPrompt += `Document Content:\n${documentText}\n\n`;
    fullPrompt += `Question: ${prompt}`;
    
    return fullPrompt;
  }

  /**
   * Parsea la respuesta de Gemini
   */
  private parseResponse(text: string, expectedType: ResponseType): any {
    try {
      // Intentar parsear como JSON primero
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          response: parsed.response || parsed.answer || text,
          confidence: parsed.confidence || 0.8,
          reasoning: parsed.reasoning || parsed.explanation || 'No reasoning provided'
        };
      }
    } catch (error) {
      this.logger.warn(`⚠️ No se pudo parsear respuesta JSON de Gemini: ${error.message}`);
    }
    
    // Fallback: crear respuesta estructurada
    return {
      response: text.trim(),
      confidence: 0.75,
      reasoning: 'Direct response - JSON parsing failed'
    };
  }

  /**
   * Analiza una imagen usando Gemini Vision
   * Compatible con GPT-4o Vision para dual validation
   */
  async analyzeWithVision(
    imageBase64: string,
    prompt: string,
    expectedType: ResponseType,
    pmcField?: string,
    pageNumber: number = 1
  ): Promise<GeminiEvaluationResult> {
    const startTime = Date.now();
    
    if (!this.isAvailable()) {
      throw new Error('Gemini Vision no está disponible');
    }
    
    try {
      
      // Rate limiting
      await this.rateLimiter.checkLimit('gemini-vision');
      
      // Construir prompt específico para análisis visual
      const visionPrompt = this.buildVisionPrompt(prompt, expectedType, pmcField);
      
      // Gemini acepta imágenes en formato inline
      const result = await this.model.generateContent([
        visionPrompt,
        {
          inlineData: {
            mimeType: "image/png",
            data: imageBase64
          }
        }
      ]);
      
      const response = await result.response;
      const text = response.text();
      
      // Parsear respuesta
      const parsedResponse = this.parseResponse(text, expectedType);
      
      const processingTime = Date.now() - startTime;
      
      this.logger.log(`✅ Gemini Vision completado en ${processingTime}ms`);
      this.logger.log(`👁️ Gemini Vision found: "${parsedResponse.response}" (confidence: ${parsedResponse.confidence})`);
      
      return {
        ...parsedResponse,
        processingTime,
        tokensUsed: response.usageMetadata?.totalTokenCount || 0,
        model: 'gemini-2.5-pro-vision'
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`❌ Error en Gemini Vision: ${error.message}`);
      
      // Métricas de error
      this.performanceMetrics.totalRequests++;
      this.performanceMetrics.errorRate = 
        ((this.performanceMetrics.totalRequests - this.performanceMetrics.successfulRequests) / 
         this.performanceMetrics.totalRequests) * 100;
      
      throw error;
    }
  }

  /**
   * Construye prompt optimizado para análisis visual
   */
  private buildVisionPrompt(prompt: string, expectedType: ResponseType, pmcField?: string): string {
    const typeInstructions = {
      [ResponseType.BOOLEAN]: 'Answer with YES or NO only.',
      [ResponseType.DATE]: 'Provide the date in MM-DD-YY format (e.g., 07-22-25). If no date is found, respond with NOT_FOUND.',
      [ResponseType.TEXT]: 'Provide a concise text response.',
      [ResponseType.NUMBER]: 'Provide only the numeric value.',
    };
    
    return `You are analyzing a document image. ${prompt}

${typeInstructions[expectedType] || ''}

IMPORTANT: Look carefully at the visual elements in the image including:
- Handwritten text, signatures, initials
- Stamps, seals, marks
- Dates written by hand
- Checkboxes and their marks
- Any visual annotations

Respond in JSON format:
{
  "response": "your answer here",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;
  }

  /**
   * Agrega resultados de múltiples chunks
   */
  private aggregateChunkResults(results: GeminiEvaluationResult[]): GeminiEvaluationResult {
    if (results.length === 1) {
      return results[0];
    }
    
    // Combinar respuestas
    const responses = results.map(r => r.response);
    const uniqueResponses = [...new Set(responses)];
    
    let finalResponse: string;
    if (uniqueResponses.length === 1) {
      finalResponse = uniqueResponses[0];
    } else {
      // Usar la respuesta del chunk con mayor confianza
      const bestResult = results.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );
      finalResponse = bestResult.response;
    }
    
    // Calcular métricas agregadas
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
    const totalTime = results.reduce((sum, r) => sum + r.processingTime, 0);
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
    
    return {
      response: finalResponse,
      confidence: avgConfidence,
      reasoning: `Aggregated from ${results.length} chunks`,
      processingTime: totalTime,
      tokensUsed: totalTokens,
      model: 'gemini-2.5-pro-chunked'
    };
  }

  /**
   * Actualiza métricas de performance - igual que Claude
   */
  private updatePerformanceMetrics(
    success: boolean, 
    latency: number, 
    tokens: number = 0
  ): void {
    this.performanceMetrics.totalRequests++;
    
    if (success) {
      this.performanceMetrics.successfulRequests++;
    }
    
    // Actualizar latencia promedio
    const currentAvg = this.performanceMetrics.averageLatency;
    const totalRequests = this.performanceMetrics.totalRequests;
    this.performanceMetrics.averageLatency = 
      (currentAvg * (totalRequests - 1) + latency) / totalRequests;
    
    // Calcular tasa de error
    this.performanceMetrics.errorRate = 
      1 - (this.performanceMetrics.successfulRequests / this.performanceMetrics.totalRequests);
    
    // Actualizar tokens
    this.performanceMetrics.totalTokensUsed += tokens;
    
    // Log si hay problemas
    if (this.performanceMetrics.errorRate > 0.1) { // >10% error rate
      this.logger.warn(`⚠️ Tasa de error Gemini alta: ${(this.performanceMetrics.errorRate * 100).toFixed(2)}%`);
    }
  }

  /**
   * Verifica si Gemini está disponible
   */
  isAvailable(): boolean {
    return isGeminiAvailable() && !!this.geminiClient && !!this.model;
  }

  /**
   * Obtiene métricas de performance
   */
  getPerformanceMetrics() {
    return { ...this.performanceMetrics };
  }

  /**
   * Resetea métricas (útil para testing)
   */
  resetMetrics(): void {
    this.performanceMetrics = {
      totalRequests: 0,
      successfulRequests: 0,
      averageLatency: 0,
      errorRate: 0,
      totalTokensUsed: 0,
    };
  }
}