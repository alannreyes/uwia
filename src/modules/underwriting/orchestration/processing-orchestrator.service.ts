import { Injectable, Logger } from '@nestjs/common';
import { PdfParserService } from '../services/pdf-parser.service';
import { OcrService } from '../services/ocr.service';
import { ModernRagService } from '../services/modern-rag.service';
import { EnhancedPdfProcessorService } from '../chunking/services/enhanced-pdf-processor.service';

@Injectable()
export class ProcessingOrchestratorService {
  private readonly logger = new Logger(ProcessingOrchestratorService.name);

  constructor(
    private readonly pdfParserService: PdfParserService,
    private readonly ocrService: OcrService,
    private readonly ragService: ModernRagService,
    private readonly chunkingService: EnhancedPdfProcessorService,
  ) {}

  async processDocument(file: { buffer: Buffer; originalname: string; size: number }): Promise<any> {
    this.logger.log(`Starting unified processing for: ${file.originalname}`);

    // 1. Content Extraction
    let extractedText = await this.extractContent(file.buffer);

    // 2. Chunking (if necessary)
    const session = await this.chunkingService.processLargePdf(file);
    
    // For now, we'll just return the extracted text.
    // RAG and other steps will be integrated next.
    return {
        message: 'Unified processing pipeline started.',
        sessionId: session.id,
        // extractedText, // This will be part of the session chunks
    };
  }

  private async extractContent(buffer: Buffer): Promise<string> {
    // Step 1: Fast text extraction
    try {
      const fastText = await this.pdfParserService.extractText(buffer);
      if (fastText && fastText.trim().length > 100) { // Basic quality check
        this.logger.log('Fast text extraction successful.');
        return fastText;
      }
    } catch (error) {
      this.logger.warn('Fast text extraction failed, trying advanced.', error.message);
    }

    // Step 2: Advanced text extraction (placeholder for pdfjs-dist logic)
    this.logger.log('Trying advanced text extraction...');
    // In a real scenario, this would call a more robust pdfjs-dist based method
    const advancedText = await this.pdfParserService.extractText(buffer);
    if (advancedText && advancedText.trim().length > 100) {
        this.logger.log('Advanced text extraction successful.');
        return advancedText;
    }


    // Step 3: OCR as fallback
    this.logger.log('No meaningful text found, attempting OCR.');
    // This part needs the pdf-to-image conversion logic, which we'll move from PdfToolkitService
    // For now, this is a placeholder.
    // const images = await this.pdfParserService.convertToImages(buffer);
    // let ocrText = '';
    // for (const image of images) {
    //   ocrText += await this.ocrService.extractTextFromImage(image);
    // }
    // return ocrText;

    return advancedText; // Return whatever we have for now
  }
}
