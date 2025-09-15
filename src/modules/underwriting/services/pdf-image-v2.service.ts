import { Injectable, Logger } from '@nestjs/common';
import { PdfToolkitService } from './pdf-toolkit.service';
import { ProductionLogger } from '../../../common/utils/production-logger';

/**
 * PdfImageServiceV2 - Enhanced PDF to Image conversion with fallback
 * Uses unified PdfToolkitService to avoid version mismatch issues
 */
@Injectable()
export class PdfImageServiceV2 {
  private readonly logger = new Logger(PdfImageServiceV2.name);
  private readonly prodLogger = new ProductionLogger(PdfImageServiceV2.name);

  constructor(private readonly pdfToolkit: PdfToolkitService) {}

  /**
   * Convert PDF pages to images with multiple fallback methods
   */
  async convertPages(
    pdfBase64: string,
    pageNumbers: number[] = [1],
    options?: {
      documentName?: string;
      highResolution?: boolean;
      forceMethod?: 'toolkit' | 'legacy';
    }
  ): Promise<Map<number, string>> {
    const startTime = Date.now();
    const docName = options?.documentName || 'unknown';

    try {
      // Clean base64 and convert to buffer
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      const pdfBuffer = Buffer.from(cleanBase64, 'base64');

      // Validate size
      const maxSize = parseInt(process.env.MAX_IMAGE_CONVERSION_SIZE) || 20971520; // 20MB
      if (pdfBuffer.length > maxSize) {
        const sizeMB = (pdfBuffer.length / 1048576).toFixed(2);
        const maxMB = (maxSize / 1048576).toFixed(2);
        this.logger.warn(`⚠️ PDF too large: ${sizeMB}MB (max: ${maxMB}MB) - will try text extraction only`);

        // Return empty map but don't throw - let text extraction handle it
        return new Map<number, string>();
      }

      // Determine resolution based on document type
      const isSignatureDoc = docName.toUpperCase().includes('LOP') ||
                            docName.toUpperCase().includes('ESTIMATE');
      const scale = options?.highResolution || isSignatureDoc ? 3.0 : 2.0;

      this.logger.log(`🖼️ Converting ${pageNumbers.length} pages from ${docName} (scale: ${scale}x)`);

      // Method 1: Try unified toolkit first
      if (!options?.forceMethod || options.forceMethod === 'toolkit') {
        try {
          this.logger.log('🔧 Using PdfToolkit for image conversion...');
          const images = await this.pdfToolkit.convertToImages(pdfBuffer, pageNumbers, scale);

          // Convert Buffer images to base64 strings
          const imageMap = new Map<number, string>();
          for (const [pageNum, imageBuffer] of images) {
            imageMap.set(pageNum, imageBuffer.toString('base64'));
          }

          const elapsed = Date.now() - startTime;
          this.logger.log(`✅ Successfully converted ${imageMap.size} pages in ${elapsed}ms`);
          this.prodLogger.performance(docName, 'pdf_conversion', elapsed / 1000, `${imageMap.size} pages`);

          return imageMap;
        } catch (toolkitError) {
          this.logger.warn(`⚠️ PdfToolkit conversion failed: ${toolkitError.message}`);

          // Continue to fallback method
          if (options?.forceMethod === 'toolkit') {
            throw toolkitError; // If forced, don't fallback
          }
        }
      }

      // Method 2: Fallback to legacy pdf-to-png-converter if available
      if (this.isLegacyAvailable()) {
        try {
          this.logger.log('🔄 Trying legacy pdf-to-png-converter...');
          return await this.convertWithLegacy(pdfBuffer, pageNumbers, scale, docName);
        } catch (legacyError) {
          this.logger.warn(`⚠️ Legacy conversion also failed: ${legacyError.message}`);
        }
      }

      // Method 3: Return empty map and rely on text extraction
      this.logger.warn('⚠️ All image conversion methods failed - returning empty map');
      this.logger.warn('📝 Document will be processed with text extraction only');

      return new Map<number, string>();

    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.logger.error(`❌ PDF image conversion failed after ${elapsed}ms: ${error.message}`);

      // Don't throw - return empty map to allow text processing to continue
      return new Map<number, string>();
    }
  }

  /**
   * Convert first page for signature detection
   */
  async convertFirstPage(pdfBase64: string, documentName?: string): Promise<string | null> {
    try {
      const images = await this.convertPages(pdfBase64, [1], {
        documentName,
        highResolution: true // Always high res for signature detection
      });

      return images.get(1) || null;
    } catch (error) {
      this.logger.error(`❌ Failed to convert first page: ${error.message}`);
      return null;
    }
  }

  /**
   * Convert last page (often contains signatures)
   */
  async convertLastPage(pdfBase64: string, documentName?: string): Promise<string | null> {
    try {
      // Get PDF info to find last page number
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      const pdfBuffer = Buffer.from(cleanBase64, 'base64');
      const info = await this.pdfToolkit.getPdfInfo(pdfBuffer);

      if (info.pageCount > 0) {
        const images = await this.convertPages(pdfBase64, [info.pageCount], {
          documentName,
          highResolution: true
        });

        return images.get(info.pageCount) || null;
      }

      return null;
    } catch (error) {
      this.logger.error(`❌ Failed to convert last page: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if legacy pdf-to-png-converter is available
   */
  private isLegacyAvailable(): boolean {
    try {
      require.resolve('pdf-to-png-converter');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Legacy conversion method using pdf-to-png-converter
   */
  private async convertWithLegacy(
    pdfBuffer: Buffer,
    pageNumbers: number[],
    scale: number,
    docName: string
  ): Promise<Map<number, string>> {
    const { pdfToPng } = require('pdf-to-png-converter');

    const conversionOptions = {
      viewportScale: scale,
      outputFileMask: 'buffer',
      pagesToProcess: pageNumbers,
      strictPagesToProcess: false,
      verbosityLevel: 0,
      disableFontFace: false,
      useSystemFonts: scale > 2.5,
      pngOptions: {
        compressionLevel: scale > 2.5 ? 0 : 6,
        palette: false,
        quality: scale > 2.5 ? 100 : 85
      }
    };

    // Add timeout
    const conversionPromise = pdfToPng(pdfBuffer, conversionOptions);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Conversion timeout (60s)')), 60000);
    });

    const pngPages = await Promise.race([conversionPromise, timeoutPromise]);

    const imageMap = new Map<number, string>();
    pngPages.forEach((page: any) => {
      const pageNum = page.pageNumber;
      const base64 = page.content.toString('base64');
      imageMap.set(pageNum, base64);
    });

    return imageMap;
  }

  /**
   * Get signature-related pages (first, last, and any page with signature fields)
   */
  async getSignaturePages(pdfBase64: string): Promise<Map<number, string>> {
    try {
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      const pdfBuffer = Buffer.from(cleanBase64, 'base64');

      // Get PDF info including form fields
      const extraction = await this.pdfToolkit.extractText(pdfBuffer);
      const info = await this.pdfToolkit.getPdfInfo(pdfBuffer);

      const signaturePages = new Set<number>();

      // Always include first and last pages
      signaturePages.add(1);
      if (info.pageCount > 1) {
        signaturePages.add(info.pageCount);
      }

      // Add any pages with signature fields
      if (extraction.formFields) {
        extraction.formFields.forEach((field: any) => {
          if (field.name?.toLowerCase().includes('sign') ||
              field.name?.toLowerCase().includes('firma')) {
            // Note: We'd need to track which page each field is on
            // For now, convert first 3 and last 2 pages for signature docs
            if (info.pageCount <= 5) {
              for (let i = 1; i <= info.pageCount; i++) {
                signaturePages.add(i);
              }
            } else {
              signaturePages.add(1);
              signaturePages.add(2);
              signaturePages.add(3);
              signaturePages.add(info.pageCount - 1);
              signaturePages.add(info.pageCount);
            }
          }
        });
      }

      const pageArray = Array.from(signaturePages).sort((a, b) => a - b);
      this.logger.log(`📝 Converting signature pages: ${pageArray.join(', ')}`);

      return await this.convertPages(pdfBase64, pageArray, {
        documentName: 'signature_pages',
        highResolution: true
      });
    } catch (error) {
      this.logger.error(`❌ Failed to get signature pages: ${error.message}`);
      return new Map<number, string>();
    }
  }
}