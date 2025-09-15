import { Injectable, Logger } from '@nestjs/common';
const pdfParse = require('pdf-parse');
import { PDFDocument, PDFTextField, PDFCheckBox } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
// Canvas is optional - will use pdf-to-png-converter as fallback if canvas not available
let createCanvas: any = null;
try {
  createCanvas = require('canvas').createCanvas;
} catch (e) {
  // Canvas not available - will use fallback methods
}

/**
 * Unified PDF Toolkit Service
 * Combines the best of multiple PDF libraries for robust extraction
 *
 * Stack:
 * - pdf-parse: Fast text extraction for simple PDFs
 * - pdf-lib: Form fields and metadata extraction
 * - pdfjs-dist: Advanced rendering and text positioning
 * - canvas: Image conversion for visual analysis
 */
@Injectable()
export class PdfToolkitService {
  private readonly logger = new Logger(PdfToolkitService.name);
  private pdfjsLib: any;

  constructor() {
    this.initializePdfJs();
  }

  /**
   * Initialize PDF.js with proper worker configuration
   */
  private initializePdfJs() {
    try {
      // Use legacy build for better compatibility
      this.pdfjsLib = pdfjsLib;

      // Set worker to avoid version mismatch
      const workerSrc = require('pdfjs-dist/legacy/build/pdf.worker.js');
      this.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

      // Configure standard fonts to avoid warnings
      this.pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/';

      this.logger.log('✅ PDF.js initialized with unified worker and standard fonts');
    } catch (error) {
      this.logger.error('Failed to initialize PDF.js:', error);
      // Fallback to CDN if local worker fails
      this.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      this.pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/';
    }
  }

  /**
   * Extract text using multiple methods for maximum accuracy
   */
  async extractText(buffer: Buffer): Promise<{
    text: string;
    metadata?: any;
    formFields?: any[];
    hasSignatures?: boolean;
  }> {
    const results = {
      text: '',
      metadata: null,
      formFields: [],
      hasSignatures: false
    };

    try {
      // Method 1: pdf-parse for quick text extraction
      this.logger.log('📄 Extracting text with pdf-parse...');
      const pdfParseResult = await pdfParse(buffer);
      results.text = pdfParseResult.text || '';
      results.metadata = pdfParseResult.info;
      this.logger.log(`✅ pdf-parse extracted: ${results.text.length} characters`);
    } catch (error) {
      this.logger.warn(`⚠️ pdf-parse failed: ${error.message}`);
    }

    try {
      // Method 2: pdf-lib for form fields and signatures
      this.logger.log('📝 Extracting form fields with pdf-lib...');
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      const fields = form.getFields();

      results.formFields = fields.map(field => {
        const fieldData: any = {
          name: field.getName(),
          type: field.constructor.name
        };

        // Extract field values
        if (field instanceof PDFTextField) {
          fieldData.value = field.getText();
          fieldData.maxLength = field.getMaxLength();
        } else if (field instanceof PDFCheckBox) {
          fieldData.checked = field.isChecked();
        }

        // Check for signature fields
        if (field.getName()?.toLowerCase().includes('sign') ||
            field.getName()?.toLowerCase().includes('firma')) {
          results.hasSignatures = true;
        }

        return fieldData;
      });

      this.logger.log(`✅ pdf-lib found ${results.formFields.length} form fields`);
      if (results.hasSignatures) {
        this.logger.log('✅ Signature fields detected');
      }
    } catch (error) {
      this.logger.warn(`⚠️ pdf-lib form extraction failed: ${error.message}`);
    }

    try {
      // Method 3: pdfjs-dist for advanced text extraction with positioning
      if (!results.text || results.text.length < 100) {
        this.logger.log('🔍 Using pdfjs-dist for advanced extraction...');
        const uint8Array = new Uint8Array(buffer);
        const loadingTask = this.pdfjsLib.getDocument({ data: uint8Array });
        const pdfDoc = await loadingTask.promise;

        let fullText = '';
        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          const page = await pdfDoc.getPage(pageNum);
          const textContent = await page.getTextContent();

          // Extract text with position information
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');

          fullText += pageText + '\n';

          // Look for signature indicators in text
          if (pageText.toLowerCase().includes('signature') ||
              pageText.toLowerCase().includes('firma') ||
              pageText.toLowerCase().includes('signed by')) {
            results.hasSignatures = true;
          }
        }

        if (fullText.length > results.text.length) {
          results.text = fullText;
          this.logger.log(`✅ pdfjs-dist extracted: ${fullText.length} characters`);
        }
      }
    } catch (error) {
      this.logger.warn(`⚠️ pdfjs-dist extraction failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Convert PDF pages to images for visual analysis
   */
  async convertToImages(
    buffer: Buffer,
    pageNumbers?: number[],
    scale: number = 2.0
  ): Promise<Map<number, Buffer>> {
    const images = new Map<number, Buffer>();

    // If canvas is available, use PDF.js + canvas method
    if (createCanvas) {
      try {
        const uint8Array = new Uint8Array(buffer);
        const loadingTask = this.pdfjsLib.getDocument({ data: uint8Array });
        const pdfDoc = await loadingTask.promise;

        const pagesToConvert = pageNumbers ||
          Array.from({ length: Math.min(pdfDoc.numPages, 10) }, (_, i) => i + 1);

        this.logger.log(`🖼️ Converting ${pagesToConvert.length} pages to images with PDF.js...`);

        for (const pageNum of pagesToConvert) {
          try {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale });

            // Create canvas using node-canvas
            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext('2d');

            // Render PDF page to canvas with font fallback options
            await page.render({
              canvasContext: context,
              viewport: viewport,
              intent: 'display',
              // Disable font warnings and use fallback rendering
              continueCallback: function(data) {
                // Skip font errors silently
                if (data.renderingState === 'finished') {
                  return;
                }
              }
            }).promise;

            // Convert canvas to buffer
            const imageBuffer = canvas.toBuffer('image/png');
            images.set(pageNum, imageBuffer);

            this.logger.log(`✅ Page ${pageNum} converted to image`);
          } catch (pageError) {
            this.logger.warn(`⚠️ Failed to convert page ${pageNum}: ${pageError.message}`);
          }
        }

        this.logger.log(`✅ Successfully converted ${images.size} pages to images`);
      } catch (error) {
        this.logger.error(`❌ PDF.js image conversion failed: ${error.message}`);
        // Fall through to pdf-to-png-converter method
      }
    }

    // Fallback to pdf-to-png-converter if canvas not available or PDF.js failed
    if (images.size === 0) {
      try {
        this.logger.log(`🔄 Using pdf-to-png-converter fallback...`);
        const { pdfToPng } = require('pdf-to-png-converter');

        const pagesToConvert = pageNumbers ||
          Array.from({ length: Math.min(10, await this.getPageCount(buffer)) }, (_, i) => i + 1);

        const conversionOptions = {
          viewportScale: scale,
          outputFileMask: 'buffer',
          pagesToProcess: pagesToConvert,
          strictPagesToProcess: false,
          verbosityLevel: 0
        };

        const pngPages = await pdfToPng(buffer, conversionOptions);

        pngPages.forEach((page: any) => {
          images.set(page.pageNumber, page.content);
        });

        this.logger.log(`✅ Fallback conversion successful: ${images.size} pages`);
      } catch (fallbackError) {
        this.logger.error(`❌ All image conversion methods failed: ${fallbackError.message}`);
        throw fallbackError;
      }
    }

    return images;
  }

  /**
   * Get page count from PDF buffer
   */
  private async getPageCount(buffer: Buffer): Promise<number> {
    try {
      const data = await pdfParse(buffer);
      return data.numpages || 1;
    } catch (error) {
      return 1;
    }
  }

  /**
   * Extract specific patterns from PDF (dates, policy numbers, etc.)
   */
  extractPatterns(text: string): {
    dates: string[];
    policyNumbers: string[];
    claimNumbers: string[];
    addresses: string[];
    signatures: boolean;
  } {
    const patterns = {
      dates: [],
      policyNumbers: [],
      claimNumbers: [],
      addresses: [],
      signatures: false
    };

    // Date patterns (MM-DD-YY, MM/DD/YYYY, etc.)
    const dateRegex = /\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\b/g;
    patterns.dates = (text.match(dateRegex) || []).map(d => d.trim());

    // Policy number patterns
    const policyRegex = /\b(?:policy|póliza)\s*(?:#|no\.?|number)?\s*:?\s*([A-Z0-9-]+)/gi;
    const policyMatches = text.matchAll(policyRegex);
    for (const match of policyMatches) {
      if (match[1]) patterns.policyNumbers.push(match[1]);
    }

    // Claim number patterns
    const claimRegex = /\b(?:claim|reclamo)\s*(?:#|no\.?|number)?\s*:?\s*([A-Z0-9-]+)/gi;
    const claimMatches = text.matchAll(claimRegex);
    for (const match of claimMatches) {
      if (match[1]) patterns.claimNumbers.push(match[1]);
    }

    // Address patterns (simplified)
    const addressRegex = /\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct),?\s+[\w\s]+,?\s+[A-Z]{2}\s+\d{5}/gi;
    patterns.addresses = (text.match(addressRegex) || []).map(a => a.trim());

    // Signature indicators
    patterns.signatures = /\b(?:signature|signed|firma|firmado)\b/i.test(text);

    return patterns;
  }

  /**
   * Check if PDF needs OCR (for scanned documents)
   */
  async needsOCR(buffer: Buffer): Promise<boolean> {
    try {
      const result = await pdfParse(buffer);

      // If text is minimal but PDF has content, likely scanned
      if (result.text.trim().length < 100 && result.numpages > 0) {
        this.logger.log('📸 PDF appears to be scanned, OCR recommended');
        return true;
      }

      // Check if text is mostly non-readable characters
      const readableChars = result.text.match(/[a-zA-Z0-9\s]/g) || [];
      const readableRatio = readableChars.length / Math.max(1, result.text.length);

      if (readableRatio < 0.5) {
        this.logger.log('📸 PDF has low readable text ratio, OCR recommended');
        return true;
      }

      return false;
    } catch (error) {
      this.logger.warn(`⚠️ Could not determine OCR need: ${error.message}`);
      return false;
    }
  }

  /**
   * Get comprehensive PDF info
   */
  async getPdfInfo(buffer: Buffer): Promise<{
    pageCount: number;
    hasText: boolean;
    hasImages: boolean;
    hasFormFields: boolean;
    hasSignatures: boolean;
    needsOCR: boolean;
    metadata: any;
  }> {
    const info = {
      pageCount: 0,
      hasText: false,
      hasImages: false,
      hasFormFields: false,
      hasSignatures: false,
      needsOCR: false,
      metadata: {}
    };

    try {
      // Get basic info
      const extraction = await this.extractText(buffer);
      info.hasText = extraction.text.length > 0;
      info.hasFormFields = extraction.formFields.length > 0;
      info.hasSignatures = extraction.hasSignatures;
      info.metadata = extraction.metadata;

      // Check for OCR need
      info.needsOCR = await this.needsOCR(buffer);

      // Get page count from pdfjs
      const uint8Array = new Uint8Array(buffer);
      const loadingTask = this.pdfjsLib.getDocument({ data: uint8Array });
      const pdfDoc = await loadingTask.promise;
      info.pageCount = pdfDoc.numPages;

      // Simple check for images (if text is minimal but pages exist)
      info.hasImages = info.pageCount > 0 && (!info.hasText || info.needsOCR);

      this.logger.log('📊 PDF Info:', info);
    } catch (error) {
      this.logger.error(`❌ Failed to get PDF info: ${error.message}`);
    }

    return info;
  }
}