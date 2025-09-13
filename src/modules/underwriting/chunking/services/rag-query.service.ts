
import { Injectable, Logger } from '@nestjs/common';
import { ChunkStorageService } from './chunk-storage.service';
import { OpenAiService } from '../../services/openai.service';
import { ResponseType } from '../../entities/uw-evaluation.entity';
import { PdfChunk } from '../entities/pdf-chunk.entity';

// ... existing code ...
interface QueryResult {
  answer: string;
  confidence: number;
  sourceChunks: string[];
  processingTime: number;
  error?: string;
}

@Injectable()
export class RagQueryService {
// ... existing code ...
  private readonly logger = new Logger(RagQueryService.name);

  constructor(
    private readonly chunkStorageService: ChunkStorageService,
    private readonly openaiService: OpenAiService,
  ) {}

  async queryDocument(sessionId: string, question: string, maxResults: number = 3): Promise<QueryResult> {
    const startTime = Date.now();
    this.logger.log(`Querying session ${sessionId} with question: "${question}"`);

    const session = await this.chunkStorageService.getSession(sessionId);
    if (!session || session.status !== 'ready') {
      throw new Error('Session is not ready for querying or does not exist.');
    }

    // 1. Keyword extraction from question
    const keywords = await this.extractKeywords(question);
    this.logger.log(`Extracted keywords: ${keywords.join(', ')}`);

    // 2. Retrieve relevant chunks
    const relevantChunks = await this.chunkStorageService.findChunksByKeywords(sessionId, keywords);
    if (relevantChunks.length === 0) {
      this.logger.warn('No relevant chunks found for the given keywords.');
      return {
        answer: 'I could not find relevant information in the document to answer the question.',
        confidence: 0,
        sourceChunks: [],
        processingTime: Date.now() - startTime,
      };
    }

    // 3. Consolidate and rank chunks (simplified for now)
    const topChunks = this.rankAndSelectChunks(relevantChunks, maxResults);
    const context = topChunks.map(chunk => chunk.content).join('\n\n---\n\n');

    // 4. Generate answer using AI
    const result = await this.openaiService.evaluateWithValidation(context, question, ResponseType.TEXT);

    const answer = result.response;
    const confidence = result.final_confidence;

    const processingTime = Date.now() - startTime;
    this.logger.log(`Query processed in ${processingTime}ms with confidence ${confidence}`);

    return {
      answer,
      confidence,
      sourceChunks: topChunks.map(c => c.id),
      processingTime,
    };
  }

  private async extractKeywords(question: string): Promise<string[]> {
    const prompt = `Extract the most important keywords from the following question. Return them as a comma-separated list.
Question: "${question}"
Keywords:`;
    
    // Using evaluateWithValidation for keyword extraction as well.
    const result = await this.openaiService.evaluateWithValidation(question, 'Extract keywords', ResponseType.TEXT);
    return result.response.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  }

  private rankAndSelectChunks(chunks: PdfChunk[], maxResults: number): PdfChunk[] {
    // Simple ranking: for now, just take the first few results.
    // A more advanced implementation would score based on keyword frequency, position, etc.
    return chunks.slice(0, maxResults);
  }
}
