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
      // Estrategia agnóstica: usar TODOS los chunks para máxima precisión
      const sessionId = filters?.sessionId;
      let semanticResults;

      if (sessionId && this.shouldUseAllChunks(sessionId)) {
        this.logger.log(`📚 [RAG] COMPREHENSIVE MODE: Using ALL chunks for maximum data accuracy`);
        semanticResults = await this.vectorStorage.getAllChunksForSession(sessionId);
        this.logger.log(`📊 [RAG] Retrieved ALL ${semanticResults.length} chunks for comprehensive analysis`);
      } else {
        // Búsqueda semántica selectiva (modo legacy)
        this.logger.log(`🔍 [RAG] SELECTIVE MODE: Using semantic search`);
        semanticResults = await this.vectorStorage.findSimilar(queryEmbedding, {
          topK: 10,
          minScore: 0.3,
          ...filters
        });
      }

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
   * 4. Context assembly optimized for RAG-sized chunks (8KB each)
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
    let chunksSkipped = 0;
    let chunksTruncated = 0;

    for (const result of results) {
      let content = result.chunk?.content || result.content || '';
      const fullTokens = this.embeddingsService.estimateTokens(content);

      // Con los nuevos chunks de 8KB (~2000 tokens), raramente deberíamos truncar
      if (fullTokens > 3000) {
        this.logger.warn(`⚠️ [RAG] Unexpectedly large chunk: ${fullTokens} tokens (expected ~2000 with 8KB chunks)`);
        if (contextParts.length === 0) {
          // Si es el primer chunk y es muy grande, truncar para que quepa
          const maxChars = Math.floor(maxTokens * 3.5);
          content = content.substring(0, maxChars);
          chunksTruncated++;
          this.logger.warn(`⚠️ [RAG] First chunk truncated from ${fullTokens} to ~${maxTokens} tokens`);
        }
      }

      const tokens = this.embeddingsService.estimateTokens(content);

      if (totalTokens + tokens > maxTokens) {
        this.logger.log(`📊 [RAG] Context limit reached: ${totalTokens} + ${tokens} > ${maxTokens} tokens`);
        chunksSkipped = results.length - contextParts.length;
        break;
      }

      contextParts.push(`[Score: ${result.score?.toFixed(3)}]\n${content}`);
      totalTokens += tokens;
    }

    const context = contextParts.join('\n\n---\n\n');

    this.logger.log(`📚 [RAG] Context assembled with RAG-optimized chunks:`);
    this.logger.log(`   - Chunks included: ${contextParts.length}/${results.length}`);
    this.logger.log(`   - Total tokens: ~${totalTokens}/${maxTokens}`);
    this.logger.log(`   - Context length: ${context.length} characters`);
    this.logger.log(`   - Chunks skipped: ${chunksSkipped}`);
    this.logger.log(`   - Chunks truncated: ${chunksTruncated}`);
    if (chunksTruncated === 0) {
      this.logger.log(`   ✅ No truncation needed with new 8KB chunking!`);
    }
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
        
        // Para consultas de texto puro, usar método de texto regular en lugar de Vision
        const directResponse = await this.openAiService.evaluateWithValidation(
          '', // Sin contexto de documento
          directPrompt,
          ResponseType.TEXT,
          undefined, // Sin contexto adicional
          'rag_query' // Campo PMC
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
      
      // Para consultas RAG con contexto de texto, usar método de texto regular
      const response = await this.openAiService.evaluateWithValidation(
        context, // Contexto del RAG
        ragPrompt,
        ResponseType.TEXT,
        undefined, // Sin contexto adicional
        'rag_query' // Campo PMC
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
   * Detecta si la consulta requiere análisis visual (firmas, sellos, etc.)
   */
  private requiresVisualAnalysis(query: string): boolean {
    const visualKeywords = [
      'signature', 'signed', 'firma', 'firmado',
      'seal', 'stamp', 'sello', 'watermark',
      'checkbox', 'checked', 'marcado',
      'handwriting', 'manuscript', 'escrito a mano',
      'initial', 'iniciales'
    ];
    
    const queryLower = query.toLowerCase();
    return visualKeywords.some(keyword => queryLower.includes(keyword));
  }

  /**
   * Pipeline híbrido RAG + Vision para Sept 2025
   * Combina búsqueda semántica con análisis visual cuando es necesario
   */
  async executeRAGPipeline(query: string, sessionId?: string, imageBase64?: string): Promise<{ answer: string, sources: any[], method: string }> {
    this.logger.log('🚀 [RAG] ========== STARTING RAG PIPELINE ==========');
    this.logger.log(`📋 [RAG] Processing query: "${query.substring(0, 100)}..."`);
    if (sessionId) {
      this.logger.log(`🎯 [RAG] Filtering results for session: ${sessionId}`);
    } else {
      this.logger.log(`🌐 [RAG] Searching all available documents (no session filter)`);
    }
    
    try {
      // Detectar si necesita análisis visual
      const needsVision = this.requiresVisualAnalysis(query);
      this.logger.log(`👁️ [RAG] Visual analysis required: ${needsVision ? 'YES' : 'NO'}`);
      
      if (needsVision && imageBase64) {
        this.logger.log(`📸 [RAG] Using HYBRID approach (RAG + Vision)`);
        return await this.executeHybridRAGVision(query, sessionId, imageBase64);
      } else if (needsVision && !imageBase64) {
        this.logger.warn(`⚠️ [RAG] Visual analysis needed but no image provided, using RAG-only`);
      }
      
      // Pipeline RAG estándar
      this.logger.log(`📚 [RAG] Using RAG-ONLY approach`);
      
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
      
      return { ...result, method: 'RAG_ONLY' };
      
    } catch (error) {
      this.logger.error(`❌ [RAG] Pipeline failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Pipeline híbrido RAG + Vision (Mejores prácticas Sept 2025)
   * Combina contexto semántico con análisis visual
   */
  private async executeHybridRAGVision(query: string, sessionId: string, imageBase64: string): Promise<{ answer: string, sources: any[], method: string }> {
    this.logger.log('🔗 [HYBRID] ========== STARTING RAG + VISION PIPELINE ==========');
    
    try {
      // 1. Obtener contexto RAG (conocimiento documental)
      const queryEmbedding = await this.generateQueryEmbedding(query);
      const keywords = this.extractKeywords(query);
      const retrievedResults = await this.multiModalRetrieve(queryEmbedding, keywords, { sessionId });
      const rerankedResults = await this.rerankAndScore(retrievedResults);
      const ragContext = await this.assembleContext(rerankedResults);
      
      this.logger.log(`📚 [HYBRID] RAG context assembled: ${ragContext.length} chars`);
      
      // 2. Crear prompt híbrido que combine RAG + Vision
      const hybridPrompt = `
        You are analyzing a document that requires both textual context and visual inspection.
        
        DOCUMENT CONTEXT FROM RAG SEARCH:
        ${ragContext}
        
        VISUAL ANALYSIS TASK:
        ${query}
        
        INSTRUCTIONS FOR HYBRID ANALYSIS:
        1. Use the RAG context to understand the document structure and content
        2. Use visual inspection to verify signatures, stamps, checkboxes, or visual elements
        3. Cross-reference both sources for maximum accuracy
        4. If RAG context mentions signatures/visual elements, verify them visually
        5. If visual analysis contradicts RAG context, prioritize visual evidence
        6. Be specific about what you can see vs. what the text context indicates
        
        CRITICAL FOR SIGNATURES:
        - Look for handwritten signatures, not just printed names
        - Check signature fields, signature lines, and signature blocks
        - Verify dates associated with signatures
        - Note if signature areas are blank vs. signed
        
        Answer the question using both textual and visual evidence.
      `;
      
      this.logger.log(`🔍 [HYBRID] Sending hybrid prompt to Vision API`);
      
      // 3. Procesar con Vision API usando contexto híbrido
      const visionResponse = await this.openAiService.evaluateWithVision(
        imageBase64,
        hybridPrompt,
        ResponseType.TEXT,
        'hybrid_rag_vision',
        1
      );
      
      this.logger.log(`✅ [HYBRID] Hybrid analysis completed`);
      this.logger.log(`📝 [HYBRID] Answer: "${visionResponse.response?.substring(0, 100)}..."`);
      
      return {
        answer: visionResponse.response || 'HYBRID_ANALYSIS_FAILED',
        sources: rerankedResults.map(r => ({ 
          chunkId: r.chunk.id, 
          score: r.score,
          type: 'RAG_CONTEXT' 
        })).concat([{
          chunkId: 'visual_analysis',
          score: 1.0,
          type: 'VISION_ANALYSIS'
        }]),
        method: 'RAG_PLUS_VISION'
      };
      
    } catch (error) {
      this.logger.error(`❌ [HYBRID] Hybrid pipeline failed: ${error.message}`);
      
      // Fallback a Vision-only si RAG falla
      this.logger.log(`🔄 [HYBRID] Falling back to Vision-only analysis`);
      try {
        const fallbackResponse = await this.openAiService.evaluateWithVision(
          imageBase64,
          query,
          ResponseType.TEXT,
          'vision_fallback',
          1
        );
        
        return {
          answer: fallbackResponse.response || 'VISION_FALLBACK_FAILED',
          sources: [{ chunkId: 'vision_fallback', score: 1.0, type: 'VISION_ONLY' }],
          method: 'VISION_FALLBACK'
        };
      } catch (fallbackError) {
        this.logger.error(`❌ [HYBRID] Vision fallback also failed: ${fallbackError.message}`);
        throw error;
      }
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

  /**
   * Determina si se deben usar todos los chunks para extracción completa de datos
   * Agnóstico - funciona para cualquier documento que requiera procesamiento completo
   */
  private shouldUseAllChunks(sessionId: string): boolean {
    // Por defecto, usar TODOS los chunks para máxima precisión
    // El asistente IA debe tener acceso al 100% de la información
    return true;
  }
}