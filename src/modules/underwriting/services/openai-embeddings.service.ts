import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

interface EmbeddingConfig {
  model: 'text-embedding-3-large' | 'text-embedding-3-small' | 'text-embedding-ada-002';
  dimensions?: number;
  maxTokens: number;
  batchSize: number;
}

interface EmbeddingResult {
  embedding: number[];
  tokens: number;
  model: string;
  dimensions: number;
}

interface BatchEmbeddingResult {
  embeddings: number[][];
  totalTokens: number;
  processingTime: number;
  errors: string[];
}

@Injectable()
export class OpenAIEmbeddingsService {
  private readonly logger = new Logger(OpenAIEmbeddingsService.name);
  private readonly openai: OpenAI;
  private readonly config: EmbeddingConfig;
  private requestCount = 0;
  private lastRequestTime = 0;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for embeddings service');
    }

    this.openai = new OpenAI({ apiKey });
    
    // Configuración optimizada para 2025
    this.config = {
      model: 'text-embedding-3-large',
      dimensions: 3072, // Máxima dimensionalidad para mejor precisión
      maxTokens: 8191,  // Límite del modelo
      batchSize: 2048,  // Procesar en lotes para eficiencia
    };

    this.logger.log(`🚀 OpenAI Embeddings Service initialized`);
    this.logger.log(`📊 Model: ${this.config.model}`);
    this.logger.log(`📐 Dimensions: ${this.config.dimensions}`);
    this.logger.log(`🎯 Max tokens per text: ${this.config.maxTokens}`);
  }

  /**
   * Genera embedding para un texto único
   */
  async embedText(text: string, customDimensions?: number): Promise<EmbeddingResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty for embedding generation');
    }

    // Aplicar rate limiting
    await this.applyRateLimit();

    // Truncar texto si es muy largo
    const truncatedText = this.truncateText(text);
    
    try {
      const startTime = Date.now();
      
      const response = await this.openai.embeddings.create({
        model: this.config.model,
        input: truncatedText,
        dimensions: customDimensions || this.config.dimensions,
        encoding_format: 'float', // Mejor precisión que base64
      });

      const embedding = response.data[0];
      const processingTime = Date.now() - startTime;

      this.logger.debug(`✅ Embedding generated: ${embedding.embedding.length}D in ${processingTime}ms`);

      return {
        embedding: embedding.embedding,
        tokens: response.usage.total_tokens,
        model: this.config.model,
        dimensions: embedding.embedding.length,
      };

    } catch (error) {
      this.logger.error(`❌ Error generating embedding: ${error.message}`);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Genera embeddings para múltiples textos en lotes (más eficiente)
   */
  async embedBatch(texts: string[], customDimensions?: number): Promise<BatchEmbeddingResult> {
    if (!texts || texts.length === 0) {
      throw new Error('Text array cannot be empty');
    }

    const startTime = Date.now();
    const embeddings: number[][] = [];
    let totalTokens = 0;
    const errors: string[] = [];

    // Procesar en lotes para eficiencia
    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      const batch = texts.slice(i, i + this.config.batchSize);
      const truncatedBatch = batch.map(text => this.truncateText(text));

      try {
        await this.applyRateLimit();

        const response = await this.openai.embeddings.create({
          model: this.config.model,
          input: truncatedBatch,
          dimensions: customDimensions || this.config.dimensions,
          encoding_format: 'float',
        });

        // Extraer embeddings del lote
        const batchEmbeddings = response.data.map(item => item.embedding);
        embeddings.push(...batchEmbeddings);
        totalTokens += response.usage.total_tokens;

        this.logger.debug(`✅ Batch ${Math.floor(i / this.config.batchSize) + 1} processed: ${batch.length} texts`);

      } catch (error) {
        this.logger.error(`❌ Error in batch ${Math.floor(i / this.config.batchSize) + 1}: ${error.message}`);
        errors.push(`Batch ${Math.floor(i / this.config.batchSize) + 1}: ${error.message}`);
        
        // Añadir embeddings vacíos para mantener índices
        for (let j = 0; j < batch.length; j++) {
          embeddings.push(new Array(customDimensions || this.config.dimensions).fill(0));
        }
      }
    }

    const processingTime = Date.now() - startTime;
    this.logger.log(`🎯 Batch embedding completed: ${texts.length} texts in ${processingTime}ms`);
    this.logger.log(`📊 Total tokens used: ${totalTokens}`);

    return {
      embeddings,
      totalTokens,
      processingTime,
      errors,
    };
  }

  /**
   * Calcula similaridad coseno entre dos embeddings
   */
  calculateCosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    return Math.max(-1, Math.min(1, similarity)); // Clamp entre -1 y 1
  }

  /**
   * Encuentra los embeddings más similares
   */
  findMostSimilar(
    queryEmbedding: number[], 
    candidateEmbeddings: { id: string; embedding: number[]; metadata?: any }[],
    topK: number = 5,
    threshold: number = 0.7
  ): Array<{ id: string; similarity: number; metadata?: any }> {
    
    const similarities = candidateEmbeddings.map(candidate => ({
      id: candidate.id,
      similarity: this.calculateCosineSimilarity(queryEmbedding, candidate.embedding),
      metadata: candidate.metadata,
    }));

    // Filtrar por threshold y ordenar por similaridad
    return similarities
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Estima el número de tokens en un texto
   */
  estimateTokens(text: string): number {
    // Estimación aproximada: 1 token ≈ 4 caracteres en inglés
    // Para texto mixto (inglés/español), usar factor de 3.5
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Trunca texto para que no exceda el límite de tokens
   */
  private truncateText(text: string): string {
    const estimatedTokens = this.estimateTokens(text);
    
    if (estimatedTokens <= this.config.maxTokens) {
      return text;
    }

    // Truncar conservando palabras completas
    const maxChars = this.config.maxTokens * 3.5;
    let truncated = text.substring(0, maxChars);
    
    // Encontrar el último espacio para no cortar palabras
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.9) {
      truncated = truncated.substring(0, lastSpace);
    }

    this.logger.warn(`⚠️ Text truncated from ${text.length} to ${truncated.length} chars`);
    return truncated;
  }

  /**
   * Rate limiting para evitar exceder límites de OpenAI
   */
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Límite: máximo 3000 RPM (50 RPS) para embeddings
    const minInterval = 1000 / 50; // 20ms entre requests
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
    
    if (this.requestCount % 100 === 0) {
      this.logger.debug(`📊 Embeddings requests made: ${this.requestCount}`);
    }
  }

  /**
   * Obtiene información sobre el modelo y configuración
   */
  getModelInfo(): EmbeddingConfig & { requestCount: number } {
    return {
      ...this.config,
      requestCount: this.requestCount,
    };
  }
}
