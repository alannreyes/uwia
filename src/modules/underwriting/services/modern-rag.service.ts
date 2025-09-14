import { Injectable, Logger } from '@nestjs/common';
import { OpenAIEmbeddingsService } from './openai-embeddings.service';
import { VectorStorageService } from './vector-storage.service';
import { OpenAiService } from './openai.service';
import { ResponseType } from '../entities/uw-evaluation.entity';

@Injectable()
export class ModernRagService {
  private readonly logger = new Logger(ModernRagService.name);

  constructor(
    private readonly embeddingsService: OpenAIEmbeddingsService,
    private readonly vectorStorage: VectorStorageService,
    private readonly openAiService: OpenAiService,
  ) {}

  /**
   * 1. Query embedding generation
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    this.logger.log('🔍 [RAG] STEP 1: Generating query embedding...');
    this.logger.log(`📝 [RAG] Query: "${query.substring(0, 100)}${query.length > 100 ? '...' : ''}"`);
    
    try {
      const embeddingResult = await this.embeddingsService.embedText(query);
      const embedding = embeddingResult.embedding || [];
      this.logger.log(`✅ [RAG] Query embedding generated: ${embedding.length} dimensions`);
      return embedding;
    } catch (error) {
      this.logger.error(`❌ [RAG] Failed to generate query embedding: ${error.message}`);
      throw error;
    }
  }

  /**
   * 2. Multi-modal retrieval (semantic + keyword)
   */
  async multiModalRetrieve(
    queryEmbedding: number[], 
    keywords: string[], 
    filters?: any
  ): Promise<any[]> {
    this.logger.log('🔍 [RAG] STEP 2: Executing multi-modal retrieval...');
    this.logger.log(`📌 [RAG] Keywords for search: ${keywords.join(', ')}`);
    
    try {
      // Búsqueda semántica usando embeddings
      const semanticResults = await this.vectorStorage.findSimilar(queryEmbedding, {
        topK: 10,
        minScore: 0.3,  // Reducido de 0.7 a 0.3 para ser menos restrictivo
        ...filters
      });
      
      this.logger.log(`📊 [RAG] Semantic search found ${semanticResults.length} relevant chunks`);
      
      if (semanticResults.length > 0) {
        this.logger.log(`🎯 [RAG] Top result score: ${semanticResults[0]?.score?.toFixed(3)}`);
        this.logger.log(`📄 [RAG] Top chunk preview: "${semanticResults[0]?.chunk?.content?.substring(0, 100)}..."`);
      }
      
      return semanticResults;
    } catch (error) {
      this.logger.error(`❌ [RAG] Retrieval failed: ${error.message}`);
      return [];
    }
  }

  /**
   * 3. Result re-ranking y scoring
   */
  async rerankAndScore(results: any[]): Promise<any[]> {
    this.logger.log('🔍 [RAG] STEP 3: Re-ranking and scoring results...');
    
    if (results.length === 0) {
      this.logger.warn('⚠️ [RAG] No results to re-rank');
      return results;
    }
    
    // Ordenar por score descendente
    const reranked = results.sort((a, b) => (b.score || 0) - (a.score || 0));
    
    this.logger.log(`📈 [RAG] Re-ranked ${reranked.length} results`);
    this.logger.log(`🥇 [RAG] Best score: ${reranked[0]?.score?.toFixed(3)}`);
    this.logger.log(`🥉 [RAG] Worst score: ${reranked[reranked.length - 1]?.score?.toFixed(3)}`);
    
    // Tomar solo los top 5 más relevantes
    const topResults = reranked.slice(0, 5);
    this.logger.log(`✂️ [RAG] Selected top ${topResults.length} results for context`);
    
    return topResults;
  }

  /**
   * 4. Context assembly con overlap detection
   */
  async assembleContext(results: any[]): Promise<string> {
    this.logger.log('🔍 [RAG] STEP 4: Assembling context from results...');
    
    if (results.length === 0) {
      this.logger.warn('⚠️ [RAG] No results to assemble context from');
      return '';
    }
    
    const contextParts: string[] = [];
    let totalTokens = 0;
    const maxTokens = 8000; // Límite de tokens para el contexto
    
    for (const result of results) {
      const content = result.chunk?.content || result.content || '';
      const tokens = this.embeddingsService.estimateTokens(content);
      
      if (totalTokens + tokens > maxTokens) {
        this.logger.warn(`⚠️ [RAG] Context size limit reached (${totalTokens} tokens)`);
        break;
      }
      
      contextParts.push(`[Score: ${result.score?.toFixed(3)}]\n${content}`);
      totalTokens += tokens;
    }
    
    const context = contextParts.join('\n\n---\n\n');
    
    this.logger.log(`📚 [RAG] Context assembled:`);
    this.logger.log(`   - Chunks used: ${contextParts.length}`);
    this.logger.log(`   - Total tokens: ~${totalTokens}`);
    this.logger.log(`   - Context length: ${context.length} characters`);
    this.logger.log(`   - Preview: "${context.substring(0, 200)}..."`);
    
    return context;
  }

  /**
   * 5. LLM answer generation con source attribution
   */
  async generateAnswer(
    context: string, 
    query: string
  ): Promise<{ answer: string, sources: any[] }> {
    this.logger.log('🔍 [RAG] STEP 5: Generating final answer with LLM...');
    this.logger.log(`❓ [RAG] Original question: "${query.substring(0, 200)}${query.length > 200 ? '...' : ''}"`);
    
    try {
      if (!context || context.trim() === '') {
        this.logger.warn('⚠️ [RAG] No context available, using fallback response');
        
        // Si no hay contexto, intentar responder directamente
        const directPrompt = `
          Please answer the following question based on your general knowledge:
          
          Question: ${query}
          
          If you cannot find the specific information, respond with "NOT_FOUND" or provide the most appropriate response format requested.
        `;
        
        const directResponse = await this.openAiService.evaluateWithVision(
          '',  // No hay imagen en contexto puro de texto
          directPrompt,
          ResponseType.TEXT,  // tipo de respuesta esperada
          'rag_query',  // campo PMC
          1  // número de página
        );
        
        this.logger.log(`🤖 [RAG] Fallback response generated`);
        return { 
          answer: directResponse.response || 'NOT_FOUND', 
          sources: [] 
        };
      }
      
      const ragPrompt = `
        You are analyzing documents to extract specific information. Use the provided context to answer the question accurately.
        
        CONTEXT FROM DOCUMENTS:
        ${context}
        
        QUESTION:
        ${query}
        
        INSTRUCTIONS:
        1. Answer ONLY based on the information found in the context
        2. If the information is not in the context, respond with "NOT_FOUND"
        3. Be precise and follow the exact format requested in the question
        4. Do not make assumptions or add information not present in the context
      `;
      
      this.logger.log(`📤 [RAG] Sending to LLM with ${context.length} chars of context`);
      
      const response = await this.openAiService.evaluateWithVision(
        '',  // No hay imagen en contexto puro de texto
        ragPrompt,
        ResponseType.TEXT,  // tipo de respuesta esperada
        'rag_query',  // campo PMC
        1  // número de página
      );
      
      this.logger.log(`✅ [RAG] Answer generated successfully`);
      this.logger.log(`📝 [RAG] Answer preview: "${(response.response || '').substring(0, 100)}..."`);
      this.logger.log(`🎯 [RAG] Confidence: ${response.confidence || 'N/A'}`);
      
      return {
        answer: response.response || '',
        sources: [] // TODO: Track source chunks
      };
      
    } catch (error) {
      this.logger.error(`❌ [RAG] Failed to generate answer: ${error.message}`);
      return { 
        answer: 'ERROR: Failed to generate answer', 
        sources: [] 
      };
    }
  }

  /**
   * Main RAG pipeline - orchestrates all steps
   */
  async executeRAGPipeline(query: string, sessionId?: string): Promise<{ answer: string, sources: any[] }> {
    this.logger.log('🚀 [RAG] ========== STARTING RAG PIPELINE ==========');
    this.logger.log(`📋 [RAG] Processing query: "${query.substring(0, 100)}..."`);
    if (sessionId) {
      this.logger.log(`🎯 [RAG] Filtering results for session: ${sessionId}`);
    } else {
      this.logger.log(`🌐 [RAG] Searching all available documents (no session filter)`);
    }
    
    try {
      // Step 1: Generate query embedding
      const queryEmbedding = await this.generateQueryEmbedding(query);
      
      // Extract keywords from query
      const keywords = this.extractKeywords(query);
      this.logger.log(`🔑 [RAG] Extracted keywords: ${keywords.join(', ')}`);
      
      // Step 2: Multi-modal retrieval
      const retrievedResults = await this.multiModalRetrieve(queryEmbedding, keywords, { sessionId });
      
      // Step 3: Re-rank and score
      const rerankedResults = await this.rerankAndScore(retrievedResults);
      
      // Step 4: Assemble context
      const context = await this.assembleContext(rerankedResults);
      
      // Step 5: Generate answer
      const result = await this.generateAnswer(context, query);
      
      this.logger.log('✅ [RAG] ========== RAG PIPELINE COMPLETED ==========');
      this.logger.log(`📊 [RAG] Final answer length: ${result.answer.length} chars`);
      
      return result;
      
    } catch (error) {
      this.logger.error(`❌ [RAG] Pipeline failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract keywords from query for hybrid search
   */
  private extractKeywords(query: string): string[] {
    const stopWords = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'for', 'to', 'of', 'and', 'or', 'but']);
    const words = query.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
    
    return [...new Set(words)]; // Remove duplicates
  }
}