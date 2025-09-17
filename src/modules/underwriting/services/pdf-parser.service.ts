import { Injectable, Logger } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { OcrService } from './ocr.service';
import * as path from 'path';
import { pathToFileURL } from 'url';

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);
  private standardFontDataUrl: string;

  constructor(private readonly ocrService: OcrService) {
    this.initializePdfJs();
  }

  private async initializePdfJs() {
    try {
  const workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      
      const fontDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/');
      this.standardFontDataUrl = pathToFileURL(fontDir).toString();

      this.logger.log('PDF.js worker and fonts initialized successfully.');
    } catch (error) {
      this.logger.error('Failed to initialize PDF.js worker:', error);
      const pdfjsVersion = require('pdfjs-dist/package.json').version;
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
      this.standardFontDataUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/standard_fonts/`;
      this.logger.warn('Using fallback CDN for PDF.js worker and fonts.');
    }
  }

  async extractText(buffer: Buffer): Promise<string> {
    this.logger.log('Attempting to extract text from PDF...');

    // Method 1: pdf-parse for quick text extraction
    try {
      const data = await pdfParse(buffer);
      if (data.text && data.text.trim().length > 100) { // Basic quality check
        this.logger.log(`Successfully extracted ${data.text.length} characters with pdf-parse.`);
        return data.text;
      }
    } catch (error) {
      this.logger.warn(`pdf-parse failed: ${error.message}`);
    }

    // Method 2: pdf.js for more complex cases
    this.logger.log('pdf-parse returned minimal text, trying with pdf.js...');
    try {
        const text = await this.extractWithPdfJs(buffer);
        if (text && text.trim().length > 0) {
            this.logger.log(`Successfully extracted ${text.length} characters with pdf.js.`);
            return text;
        }
    } catch(error) {
        this.logger.error(`pdf.js extraction failed: ${error.message}`);
    }

    // Method 3: OCR Fallback
    this.logger.log('All text extraction methods failed or returned minimal text. Attempting OCR.');
    try {
        const images = await this.convertToImages(buffer);
        if (images.size === 0) {
            this.logger.warn('Could not convert PDF to images for OCR.');
            throw new Error('Image conversion for OCR failed.');
        }
        let ocrText = '';
        for (const imageBuffer of images.values()) {
            ocrText += await this.ocrService.extractTextFromImage(imageBuffer) + '\n';
        }
        if (ocrText.trim().length > 0) {
            this.logger.log(`OCR extracted ${ocrText.length} characters.`);
            return ocrText;
        }
    } catch (ocrError) {
        this.logger.error(`OCR extraction failed: ${ocrError.message}`);
    }

    this.logger.error('All extraction methods, including OCR, failed.');
    return '';
  }

  async extractTextByPages(buffer: Buffer): Promise<{ page: number; content: string }[]> {
    this.logger.log('Extracting text page by page using pdf.js...');
    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({
      data: uint8Array,
      standardFontDataUrl: this.standardFontDataUrl,
    });

    try {
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      const pages = [];
      let totalCharsExtracted = 0;

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        pages.push({ page: i, content: pageText });
        totalCharsExtracted += pageText.length;
        page.cleanup(); // Clean up page resources
      }
      
      this.logger.log(`Extracted ${pages.length} pages with total ${totalCharsExtracted} characters.`);
      
      // 🚀 FIX: If pdfjs-dist extracted very little text, use pdf-parse fallback immediately
      if (totalCharsExtracted < 100) {
        this.logger.warn(`⚠️ pdfjs-dist extracted only ${totalCharsExtracted} chars, using pdf-parse fallback...`);
        const fullText = await this.extractText(buffer);
        if (fullText && fullText.length > totalCharsExtracted) {
          this.logger.log(`✅ pdf-parse fallback extracted ${fullText.length} chars (better than ${totalCharsExtracted})`);
          return [{ page: 1, content: fullText }];
        }
      }
      
      return pages;
    } catch (error) {
      this.logger.error(`Failed to extract text by pages: ${error.message}`);
      // Fallback to single-page extraction
      const fullText = await this.extractText(buffer);
      if (fullText) {
        this.logger.log(`✅ Fallback extracted ${fullText.length} characters`);
        return [{ page: 1, content: fullText }];
      }
      return [];
    }
  }

  private async extractWithPdfJs(buffer: Buffer): Promise<string> {
    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({
      data: uint8Array,
      standardFontDataUrl: this.standardFontDataUrl,
    });

    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += textContent.items.map((item: any) => item.str).join(' ');
      fullText += '\n';
      page.cleanup();
    }
    return fullText;
  }

  async convertToImages(
    buffer: Buffer,
    pageNumbers?: number[],
    scale: number = 2.0
  ): Promise<Map<number, Buffer>> {
    const images = new Map<number, Buffer>();
    let createCanvas;
    try {
      createCanvas = require('canvas').createCanvas;
    } catch (e) {
      this.logger.error('`canvas` package not found, cannot convert PDF to images. Please install it.');
      return images;
    }

    try {
      const uint8Array = new Uint8Array(buffer);
      const loadingTask = pdfjs.getDocument({ data: uint8Array, standardFontDataUrl: this.standardFontDataUrl });
      const pdfDoc = await loadingTask.promise;

      const pagesToConvert = pageNumbers ||
        Array.from({ length: Math.min(pdfDoc.numPages, 10) }, (_, i) => i + 1);

      this.logger.log(`Converting ${pagesToConvert.length} pages to images...`);

      for (const pageNum of pagesToConvert) {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale });
          const canvas = createCanvas(viewport.width, viewport.height);
          const context = canvas.getContext('2d');

          await page.render({
            canvas: canvas,
            canvasContext: context,
            viewport: viewport,
          }).promise;

          const imageBuffer = canvas.toBuffer('image/png');
          images.set(pageNum, imageBuffer);
        } catch (pageError) {
          this.logger.warn(`Failed to convert page ${pageNum}: ${pageError.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`PDF to image conversion failed: ${error.message}`);
    }
    return images;
  }
}