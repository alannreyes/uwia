import { Injectable, Logger } from '@nestjs/common';
import { modelConfig } from '../../../config/model.config';

export interface ClaudeChunk {
  content: string;
  tokens: number;
  priority: 'high' | 'medium' | 'low';
  type: 'header' | 'content' | 'footer' | 'metadata';
  startIndex: number;
  endIndex: number;
}

export interface ChunkingStrategy {
  useChunking: boolean;
  maxChunkTokens: number;
  overlapTokens: number;
  prioritizeContent: boolean;
  reason: string;
}

@Injectable()
export class ClaudeChunkingService {
  private readonly logger = new Logger(ClaudeChunkingService.name);

  /**
   * Determina si se necesita chunking y la estrategia a usar
   */
  determineChunkingStrategy(
    documentText: string,
    prompt: string,
    pmcField?: string
  ): ChunkingStrategy {
    const docLength = documentText.length;
    const estimatedTokens = Math.ceil(documentText.length / 3.5); // ~3.5 chars per token
    const promptTokens = Math.ceil(prompt.length / 3.5);
    const totalTokens = estimatedTokens + promptTokens;

    this.logger.log(`📏 Document analysis: ${docLength} chars, ~${estimatedTokens} tokens, prompt: ${promptTokens} tokens`);

    // No chunking needed if within limits
    if (totalTokens <= (modelConfig.claude.maxContextTokens * 0.8)) { // 80% safety margin
      return {
        useChunking: false,
        maxChunkTokens: 0,
        overlapTokens: 0,
        prioritizeContent: false,
        reason: `Document fits in context (${totalTokens} tokens < ${Math.floor(modelConfig.claude.maxContextTokens * 0.8)} limit)`
      };
    }

    // Smart chunking strategy based on field type
    const isSignatureField = pmcField?.toLowerCase().includes('sign') || 
                            prompt.toLowerCase().includes('sign');
    const isDateField = pmcField?.toLowerCase().includes('date') || 
                       prompt.toLowerCase().includes('date');
    const isPolicyField = pmcField?.toLowerCase().includes('policy') || 
                         prompt.toLowerCase().includes('policy');

    // Calculate optimal chunk size
    const availableTokens = modelConfig.claude.maxContextTokens - promptTokens - 1000; // 1000 tokens safety buffer
    const maxChunkTokens = Math.min(availableTokens, 150000); // Max 150K tokens per chunk
    const overlapTokens = isSignatureField ? 2000 : (isDateField ? 1000 : 500); // More overlap for complex fields

    return {
      useChunking: true,
      maxChunkTokens,
      overlapTokens,
      prioritizeContent: isSignatureField || isPolicyField,
      reason: `Document too large (${totalTokens} tokens). Using smart chunking: ${maxChunkTokens} tokens per chunk`
    };
  }

  /**
   * Divide el documento en chunks inteligentes
   */
  chunkDocument(
    documentText: string,
    strategy: ChunkingStrategy,
    prompt: string,
    pmcField?: string
  ): ClaudeChunk[] {
    if (!strategy.useChunking) {
      return [{
        content: documentText,
        tokens: Math.ceil(documentText.length / 3.5),
        priority: 'high',
        type: 'content',
        startIndex: 0,
        endIndex: documentText.length
      }];
    }

    this.logger.log(`🔪 Chunking document: ${strategy.maxChunkTokens} tokens per chunk, ${strategy.overlapTokens} overlap`);

    const chunks: ClaudeChunk[] = [];
    const maxChunkChars = strategy.maxChunkTokens * 3.5; // Convert tokens to approximate chars
    const overlapChars = strategy.overlapTokens * 3.5;

    // Try to split by natural boundaries first
    const sections = this.findNaturalSections(documentText, pmcField);
    
    if (sections.length > 1 && this.canUseNaturalSections(sections, maxChunkChars)) {
      // Use natural sections if they fit well
      return this.createChunksFromSections(sections, strategy.maxChunkTokens);
    }

    // Fall back to sliding window chunking with smart boundaries
    let currentIndex = 0;
    let chunkNumber = 0;

    while (currentIndex < documentText.length) {
      const chunkStart = Math.max(0, currentIndex - (chunkNumber === 0 ? 0 : overlapChars));
      const chunkEnd = Math.min(documentText.length, currentIndex + maxChunkChars);
      
      // Try to find a good boundary (sentence, paragraph, or word)
      const adjustedEnd = this.findGoodBoundary(documentText, chunkEnd, chunkStart);
      
      const chunkContent = documentText.substring(chunkStart, adjustedEnd);
      const chunkTokens = Math.ceil(chunkContent.length / 3.5);

      // Determine chunk priority based on content relevance
      const priority = this.determineChunkPriority(chunkContent, prompt, pmcField);
      
      chunks.push({
        content: chunkContent,
        tokens: chunkTokens,
        priority,
        type: this.determineChunkType(chunkContent, chunkNumber, chunks.length === 0),
        startIndex: chunkStart,
        endIndex: adjustedEnd
      });

      this.logger.log(`📄 Chunk ${chunkNumber + 1}: ${chunkContent.length} chars (~${chunkTokens} tokens), priority: ${priority}`);

      currentIndex = adjustedEnd;
      chunkNumber++;

      // Safety check to avoid infinite loops
      if (chunkNumber > 50) {
        this.logger.error('⚠️ Too many chunks generated, breaking loop');
        break;
      }
    }

    // Sort chunks by priority for processing
    if (strategy.prioritizeContent) {
      chunks.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
    }

    this.logger.log(`✅ Created ${chunks.length} chunks with priorities: ${chunks.map(c => c.priority).join(', ')}`);
    return chunks;
  }

  /**
   * Procesa chunks de forma inteligente para Claude
   */
  async processChunksWithClaude(
    chunks: ClaudeChunk[],
    prompt: string,
    pmcField: string,
    claudeProcessor: (content: string, prompt: string) => Promise<{ response: string; confidence: number }>
  ): Promise<{ response: string; confidence: number; chunksProcessed: number }> {
    
    if (chunks.length === 1) {
      const result = await claudeProcessor(chunks[0].content, prompt);
      return { ...result, chunksProcessed: 1 };
    }

    this.logger.log(`🔄 Processing ${chunks.length} chunks with Claude Sonnet 4`);

    const results: Array<{ response: string; confidence: number; priority: string }> = [];

    // Process chunks in priority order
    for (let i = 0; i < Math.min(chunks.length, 3); i++) { // Limit to first 3 chunks for cost efficiency
      const chunk = chunks[i];
      
      try {
        const chunkPrompt = this.buildChunkPrompt(prompt, chunk, i + 1, chunks.length);
        const result = await claudeProcessor(chunk.content, chunkPrompt);
        
        results.push({
          response: result.response,
          confidence: result.confidence,
          priority: chunk.priority
        });

        this.logger.log(`✅ Chunk ${i + 1} processed: ${result.response.substring(0, 50)}... (confidence: ${result.confidence})`);

        // Early exit if we found a high-confidence answer
        if (result.confidence > 0.9 && !result.response.toLowerCase().includes('not_found')) {
          this.logger.log(`🎯 High confidence answer found in chunk ${i + 1}, stopping processing`);
          return { 
            response: result.response, 
            confidence: result.confidence,
            chunksProcessed: i + 1 
          };
        }
        
      } catch (error) {
        this.logger.warn(`⚠️ Error processing chunk ${i + 1}: ${error.message}`);
        continue;
      }
    }

    // Combine results intelligently
    return this.combineChunkResults(results, pmcField);
  }

  /**
   * Encuentra secciones naturales en el documento
   */
  private findNaturalSections(documentText: string, pmcField?: string): string[] {
    // Try to split by pages, sections, or forms
    const pageBreaks = documentText.split(/\n\s*\n\s*|\f|\n---+\n/);
    
    if (pageBreaks.length > 2) {
      return pageBreaks.filter(section => section.trim().length > 100);
    }

    // Try to split by headers or section markers
    const headerSections = documentText.split(/\n\s*[A-Z][A-Z\s]{10,}\n/);
    
    if (headerSections.length > 2) {
      return headerSections.filter(section => section.trim().length > 100);
    }

    // Fall back to paragraph-based splitting
    return documentText.split(/\n\s*\n/).filter(para => para.trim().length > 50);
  }

  /**
   * Verifica si las secciones naturales son utilizables
   */
  private canUseNaturalSections(sections: string[], maxChunkChars: number): boolean {
    const largeSections = sections.filter(section => section.length > maxChunkChars * 1.5);
    return largeSections.length <= sections.length * 0.3; // Max 30% oversized sections
  }

  /**
   * Crea chunks a partir de secciones naturales
   */
  private createChunksFromSections(sections: string[], maxTokens: number): ClaudeChunk[] {
    const chunks: ClaudeChunk[] = [];
    
    sections.forEach((section, index) => {
      const tokens = Math.ceil(section.length / 3.5);
      
      chunks.push({
        content: section,
        tokens,
        priority: index === 0 ? 'high' : (index < sections.length / 2 ? 'medium' : 'low'),
        type: index === 0 ? 'header' : (index === sections.length - 1 ? 'footer' : 'content'),
        startIndex: 0, // Would need more complex calculation for actual indices
        endIndex: section.length
      });
    });

    return chunks;
  }

  /**
   * Encuentra un buen límite para cortar el chunk
   */
  private findGoodBoundary(text: string, idealEnd: number, start: number): number {
    if (idealEnd >= text.length) return text.length;

    // Try to find sentence boundary within 200 chars of ideal end
    const searchStart = Math.max(start, idealEnd - 200);
    const searchEnd = Math.min(text.length, idealEnd + 200);
    const searchText = text.substring(searchStart, searchEnd);

    // Look for sentence endings
    const sentenceEndings = /[.!?]\s+/g;
    let match;
    let bestBoundary = idealEnd;

    while ((match = sentenceEndings.exec(searchText)) !== null) {
      const absolutePos = searchStart + match.index + match[0].length;
      if (absolutePos <= idealEnd + 100) {
        bestBoundary = absolutePos;
      }
    }

    // If no sentence boundary, try paragraph
    if (bestBoundary === idealEnd) {
      const paragraphBreak = searchText.lastIndexOf('\n\n');
      if (paragraphBreak > 0) {
        bestBoundary = searchStart + paragraphBreak + 2;
      }
    }

    return Math.min(bestBoundary, text.length);
  }

  /**
   * Determina la prioridad del chunk basada en su contenido
   */
  private determineChunkPriority(
    content: string, 
    prompt: string, 
    pmcField?: string
  ): 'high' | 'medium' | 'low' {
    const contentLower = content.toLowerCase();
    const promptKeywords = prompt.toLowerCase().match(/\b\w{4,}\b/g) || [];
    const fieldKeywords = pmcField?.toLowerCase().split(/[_\s]+/) || [];
    
    // Combine all relevant keywords
    const allKeywords = [...promptKeywords, ...fieldKeywords];
    
    // Count keyword matches
    const keywordMatches = allKeywords.filter(keyword => 
      keyword.length > 3 && contentLower.includes(keyword)
    ).length;

    // Special patterns for high priority
    const highPriorityPatterns = [
      /signature|signed|sign/i,
      /policy\s*number|policy\s*#/i,
      /claim\s*number|claim\s*#/i,
      /date\s*of\s*loss/i,
      /coverage|covered|exclude/i
    ];

    const hasHighPriorityContent = highPriorityPatterns.some(pattern => 
      pattern.test(content)
    );

    if (hasHighPriorityContent || keywordMatches > 3) {
      return 'high';
    } else if (keywordMatches > 1) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Determina el tipo de chunk
   */
  private determineChunkType(
    content: string, 
    index: number, 
    isFirst: boolean
  ): 'header' | 'content' | 'footer' | 'metadata' {
    if (isFirst && content.includes('policy') && content.includes('number')) {
      return 'header';
    }
    
    if (content.includes('signature') || content.includes('date')) {
      return 'metadata';
    }
    
    return 'content';
  }

  /**
   * Construye un prompt específico para el chunk
   */
  private buildChunkPrompt(
    originalPrompt: string,
    chunk: ClaudeChunk,
    chunkIndex: number,
    totalChunks: number
  ): string {
    const contextInfo = totalChunks > 1 
      ? `\n\nCONTEXT: This is chunk ${chunkIndex} of ${totalChunks} from a larger document. Priority: ${chunk.priority.toUpperCase()}.`
      : '';

    return `${originalPrompt}${contextInfo}\n\nIf the information is not found in this chunk, respond with "NOT_FOUND_IN_CHUNK".`;
  }

  /**
   * Combina resultados de múltiples chunks
   */
  private combineChunkResults(
    results: Array<{ response: string; confidence: number; priority: string }>,
    pmcField: string
  ): { response: string; confidence: number; chunksProcessed: number } {
    
    // Filter out NOT_FOUND responses
    const validResults = results.filter(r => 
      !r.response.toLowerCase().includes('not_found') && 
      !r.response.toLowerCase().includes('not_found_in_chunk')
    );

    if (validResults.length === 0) {
      // No valid results found
      return {
        response: 'NOT_FOUND',
        confidence: 0.5,
        chunksProcessed: results.length
      };
    }

    // If we have only one valid result, return it
    if (validResults.length === 1) {
      return {
        response: validResults[0].response,
        confidence: validResults[0].confidence,
        chunksProcessed: results.length
      };
    }

    // Multiple valid results - choose the highest confidence from high priority chunks
    const highPriorityResults = validResults.filter(r => r.priority === 'high');
    const bestResults = highPriorityResults.length > 0 ? highPriorityResults : validResults;
    
    // Sort by confidence and take the best
    bestResults.sort((a, b) => b.confidence - a.confidence);
    
    const bestResult = bestResults[0];
    
    // Boost confidence slightly if multiple chunks agreed
    const agreementBonus = validResults.length > 1 ? 0.1 : 0;
    
    this.logger.log(`🔗 Combined ${validResults.length} valid results, selected: ${bestResult.response.substring(0, 50)}...`);
    
    return {
      response: bestResult.response,
      confidence: Math.min(1.0, bestResult.confidence + agreementBonus),
      chunksProcessed: results.length
    };
  }
}