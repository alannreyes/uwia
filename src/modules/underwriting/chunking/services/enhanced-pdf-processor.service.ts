
import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { PdfParserService } from '../../services/pdf-parser.service';
import { ChunkStorageService } from './chunk-storage.service';
import { MemoryManagerService } from './memory-manager.service';
import { OpenAiService } from '../../services/openai.service';
import { PdfProcessingSession } from '../entities/pdf-processing-session.entity';

@Injectable()
export class EnhancedPdfProcessorService {
  private readonly logger = new Logger(EnhancedPdfProcessorService.name);

  constructor(
    private readonly pdfParserService: PdfParserService,
    private readonly chunkStorageService: ChunkStorageService,
    private readonly memoryManagerService: MemoryManagerService,
    private readonly openaiService: OpenAiService,
  ) {}

  async processLargePdf(file: { buffer: Buffer; originalname: string; size: number }): Promise<PdfProcessingSession> {
    const { buffer, originalname, size } = file;
    this.logger.log(`Starting processing for large PDF: ${originalname} (${(size / 1024 / 1024).toFixed(2)} MB)`);

    const config = this.memoryManagerService.getProcessingConfig(size);
    const session = await this.chunkStorageService.createSession(originalname, size);

    if (config.chunkSize === 0) {
      this.logger.log('File size is within normal limits, processing without chunking.');
      const text = await this.pdfParserService.extractText(buffer);
      await this.chunkStorageService.storeChunk(session.id, 0, text);
      await this.chunkStorageService.updateSession(session.id, { totalChunks: 1, processedChunks: 1, status: 'ready' });
      return this.chunkStorageService.getSession(session.id);
    }

    this.logger.log(`Applying chunking strategy: size=${config.chunkSize}, parallel=${config.maxParallel}`);

    // Start processing asynchronously but don't block
    this.logger.log(`🎯 [ENHANCED-PDF] About to start setImmediate for session ${session.id}`);
    this.logger.log(`🎯 [ENHANCED-PDF] Buffer size: ${buffer.length} bytes, Session: ${session.id}`);

    setImmediate(async () => {
      this.logger.log(`🔥 [ENHANCED-PDF] setImmediate callback executing for session ${session.id}`);
      try {
        await this.processInBatches(buffer, session.id, config.chunkSize, config.maxParallel);
      } catch (err) {
        this.logger.error(`❌ [ENHANCED-PDF] Error during async batch processing for session ${session.id}: ${err.message}`);
        this.logger.error(`❌ [ENHANCED-PDF] Error stack: ${err.stack}`);
        await this.chunkStorageService.updateSessionStatus(session.id, 'error');
      }
    });

    return session;
  }

  private async processInBatches(buffer: Buffer, sessionId: string, chunkSize: number, maxParallel: number): Promise<void> {
    this.logger.log(`🚀 [BATCH-PROCESSING] Starting batch processing for session ${sessionId}`);
    this.logger.log(`   - Chunk size: ${chunkSize} bytes`);
    this.logger.log(`   - Max parallel: ${maxParallel}`);
    this.logger.log(`   - Buffer size: ${buffer.length} bytes`);

    const stream = Readable.from(buffer);
    const textPages = await this.pdfParserService.extractTextByPages(buffer);
    this.logger.log(`📄 [BATCH-PROCESSING] Extracted ${textPages.length} pages from PDF`);
    
    // 🚀 SPECIAL HANDLING: Single page with massive content (POLICY.pdf case)
    if (textPages.length === 1 && textPages[0].content.length > 1_000_000) {
      this.logger.log(`🔄 [BATCH-PROCESSING] Single massive page detected: ${textPages[0].content.length} chars`);
      this.logger.log(`🔪 [BATCH-PROCESSING] Splitting into 8KB chunks for embedding efficiency`);
      
      const largeContent = textPages[0].content;
      const chunkSize8KB = 8192; // 8KB chunks
      const splitChunks = [];
      
      for (let i = 0; i < largeContent.length; i += chunkSize8KB) {
        const chunkContent = largeContent.slice(i, i + chunkSize8KB);
        splitChunks.push({
          page: 1,
          content: chunkContent
        });
      }
      
      this.logger.log(`✂️ [BATCH-PROCESSING] Split massive page into ${splitChunks.length} chunks of ~8KB each`);
      
      // Replace the single massive page with multiple manageable chunks
      textPages.splice(0, 1, ...splitChunks);
      this.logger.log(`📄 [BATCH-PROCESSING] Now processing ${textPages.length} manageable chunks`);
    }
    
    if (textPages.length === 0) {
      this.logger.warn(`⚠️ [BATCH-PROCESSING] 0 pages extracted; using full-text fallback as single chunk`);
      try {
        const fullText = await this.pdfParserService.extractText(buffer);
        await this.chunkStorageService.storeChunk(sessionId, 0, fullText, 1, 1);
        await this.chunkStorageService.updateSession(sessionId, { totalChunks: 1, processedChunks: 1 });
        await this.chunkStorageService.updateSessionStatus(sessionId, 'ready');
        this.logger.log(`[${sessionId}] Fallback single-chunk stored; session marked ready.`);
        return;
      } catch (fallbackErr) {
        this.logger.error(`❌ [BATCH-PROCESSING] Fallback full-text extraction failed: ${fallbackErr.message}`);
        await this.chunkStorageService.updateSessionStatus(sessionId, 'error');
        return;
      }
    }
    
    let totalChunks = 0;
    let processedChunks = 0;
    
    const chunks = this.createChunksFromPages(textPages, chunkSize);
    totalChunks = chunks.length;
    await this.chunkStorageService.updateSession(sessionId, { totalChunks });

    const batchSize = maxParallel;
    for (let i = 0; i < totalChunks; i += batchSize) {
        await this.memoryManagerService.pauseIfNeeded();
        const batch = chunks.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (chunk, index) => {
            const chunkIndex = i + index;
            await this.chunkStorageService.storeChunk(sessionId, chunkIndex, chunk.content, chunk.pageStart, chunk.pageEnd);
            // Optionally, generate summary here
        }));

        processedChunks += batch.length;
        await this.chunkStorageService.updateSession(sessionId, { processedChunks });
        this.logger.log(`[${sessionId}] Processed batch: ${processedChunks}/${totalChunks} chunks stored.`);
    }

    await this.chunkStorageService.updateSessionStatus(sessionId, 'ready');
    this.logger.log(`[${sessionId}] Successfully processed all ${totalChunks} chunks. Session is ready.`);
  }

  private createChunksFromPages(pages: {page: number, content: string}[], chunkSize: number): {content: string, pageStart: number, pageEnd: number}[] {
    const chunks = [];
    let currentChunk = '';
    let pageStart = pages.length > 0 ? pages[0].page : 0;
    let pageEnd = pageStart;

    for (const page of pages) {
        if (currentChunk.length + page.content.length > chunkSize) {
            chunks.push({ content: currentChunk, pageStart, pageEnd });
            currentChunk = page.content;
            pageStart = page.page;
            pageEnd = page.page;
        } else {
            currentChunk += '\n' + page.content;
            pageEnd = page.page;
        }
    }
    if (currentChunk) {
        chunks.push({ content: currentChunk, pageStart, pageEnd });
    }
    return chunks;
  }

  /**
   * Obtiene los chunks procesados de una sesión para usar en RAG
   */
  async getProcessedChunks(sessionId: string) {
    this.logger.log(`📦 [ENHANCED-PDF] Retrieving processed chunks for session ${sessionId}`);
    
    try {
      const chunks = await this.chunkStorageService.getChunks(sessionId);
      this.logger.log(`✅ [ENHANCED-PDF] Found ${chunks.length} chunks for session ${sessionId}`);
      return chunks;
    } catch (error) {
      this.logger.error(`❌ [ENHANCED-PDF] Failed to get chunks for session ${sessionId}: ${error.message}`);
      throw error;
    }
  }
}
