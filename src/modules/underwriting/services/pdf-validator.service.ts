import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PdfValidatorService {
  private readonly logger = new Logger(PdfValidatorService.name);

  /**
   * Validates and repairs corrupted PDF buffers
   * Handles cases like multipart/form-data wrapping, incorrect headers, etc.
   */
  async validateAndRepairPdf(buffer: Buffer, filename?: string): Promise<{
    isValid: boolean;
    wasRepaired: boolean;
    buffer: Buffer;
    error?: string;
    details?: string;
  }> {
    try {
      // Check if buffer is empty
      if (!buffer || buffer.length === 0) {
        return {
          isValid: false,
          wasRepaired: false,
          buffer: buffer,
          error: 'Empty buffer provided'
        };
      }

      // Check PDF header
      const header = buffer.subarray(0, Math.min(100, buffer.length)).toString('ascii');

      // Case 1: Valid PDF
      if (header.startsWith('%PDF-')) {
        this.logger.log(`✅ [PDF-VALIDATOR] Valid PDF detected for ${filename || 'unknown'}`);
        return {
          isValid: true,
          wasRepaired: false,
          buffer: buffer
        };
      }

      // Case 2: Multipart form data wrapping
      if (header.includes('Content-Type: application/pdf') || header.includes('Content-Type: multipart')) {
        this.logger.warn(`⚠️ [PDF-VALIDATOR] Multipart/form-data detected in ${filename || 'unknown'}, attempting repair...`);

        const repaired = this.extractPdfFromMultipart(buffer);
        if (repaired) {
          this.logger.log(`✅ [PDF-VALIDATOR] Successfully extracted PDF from multipart data`);
          this.logger.log(`📊 [PDF-VALIDATOR] Original size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB -> Repaired: ${(repaired.length / 1024 / 1024).toFixed(2)}MB`);
          return {
            isValid: true,
            wasRepaired: true,
            buffer: repaired,
            details: `Extracted PDF from multipart/form-data wrapper`
          };
        }
      }

      // Case 3: Base64 encoded PDF
      if (this.isBase64(header)) {
        this.logger.warn(`⚠️ [PDF-VALIDATOR] Base64 encoded data detected, attempting decode...`);
        try {
          const decoded = Buffer.from(buffer.toString('ascii'), 'base64');
          const decodedHeader = decoded.subarray(0, 5).toString('ascii');

          if (decodedHeader.startsWith('%PDF-')) {
            this.logger.log(`✅ [PDF-VALIDATOR] Successfully decoded Base64 PDF`);
            return {
              isValid: true,
              wasRepaired: true,
              buffer: decoded,
              details: 'Decoded from Base64'
            };
          }
        } catch (e) {
          this.logger.warn(`⚠️ [PDF-VALIDATOR] Base64 decode failed: ${e.message}`);
        }
      }

      // Case 4: PDF with extra bytes at beginning
      const pdfStart = buffer.indexOf(Buffer.from('%PDF-'));
      if (pdfStart > 0 && pdfStart < 1024) { // PDF header within first 1KB
        this.logger.warn(`⚠️ [PDF-VALIDATOR] PDF header found at offset ${pdfStart}, trimming extra bytes...`);
        const trimmed = buffer.subarray(pdfStart);
        return {
          isValid: true,
          wasRepaired: true,
          buffer: trimmed,
          details: `Removed ${pdfStart} bytes from beginning`
        };
      }

      // Case 5: Completely corrupted or unknown format
      this.logger.error(`❌ [PDF-VALIDATOR] Unable to validate or repair PDF: ${filename || 'unknown'}`);
      this.logger.error(`❌ [PDF-VALIDATOR] Header preview: ${header.substring(0, 50)}`);

      return {
        isValid: false,
        wasRepaired: false,
        buffer: buffer,
        error: `Invalid PDF format - header: ${header.substring(0, 20)}`
      };

    } catch (error) {
      this.logger.error(`❌ [PDF-VALIDATOR] Unexpected error: ${error.message}`);
      return {
        isValid: false,
        wasRepaired: false,
        buffer: buffer,
        error: error.message
      };
    }
  }

  /**
   * Extract PDF from multipart/form-data wrapper
   */
  private extractPdfFromMultipart(buffer: Buffer): Buffer | null {
    try {
      // Method 1: Look for %PDF- marker
      const pdfStartPattern = Buffer.from('%PDF-');
      const pdfStart = buffer.indexOf(pdfStartPattern);

      if (pdfStart === -1) {
        // Method 2: Look for content after headers (double CRLF)
        const contentStart = buffer.indexOf(Buffer.from('\r\n\r\n'));
        if (contentStart !== -1) {
          const possiblePdfStart = contentStart + 4;
          const extractedData = buffer.subarray(possiblePdfStart);

          // Look for boundary end
          const boundaryEndPattern = Buffer.from('\r\n--');
          const boundaryEnd = extractedData.indexOf(boundaryEndPattern);

          if (boundaryEnd !== -1) {
            const pdfData = extractedData.subarray(0, boundaryEnd);

            // Verify it's a PDF
            const header = pdfData.subarray(0, 5).toString('ascii');
            if (header.startsWith('%PDF-')) {
              return pdfData;
            }
          }
        }

        this.logger.warn('⚠️ [PDF-VALIDATOR] No PDF markers found in multipart data');
        return null;
      }

      // Find PDF end
      const pdfEndPattern = Buffer.from('%%EOF');
      let pdfEnd = buffer.lastIndexOf(pdfEndPattern);

      if (pdfEnd === -1) {
        // If no EOF marker, look for multipart boundary after PDF start
        const fromPdfStart = buffer.subarray(pdfStart);
        const boundaryPattern = Buffer.from('\r\n--');
        const boundaryPos = fromPdfStart.indexOf(boundaryPattern);

        if (boundaryPos !== -1) {
          pdfEnd = pdfStart + boundaryPos;
        } else {
          // Use entire remaining buffer
          pdfEnd = buffer.length;
        }
      } else {
        pdfEnd += pdfEndPattern.length;
      }

      const pdfData = buffer.subarray(pdfStart, pdfEnd);

      // Validate extracted data
      if (pdfData.length > 100) { // Minimum reasonable PDF size
        return pdfData;
      }

      return null;
    } catch (error) {
      this.logger.error(`❌ [PDF-VALIDATOR] Multipart extraction failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if string looks like Base64
   */
  private isBase64(str: string): boolean {
    // Remove whitespace and check if it matches base64 pattern
    const cleaned = str.replace(/\s/g, '');
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    return cleaned.length > 20 && base64Regex.test(cleaned.substring(0, 100));
  }

  /**
   * Validate PDF structure (basic validation)
   */
  async validatePdfStructure(buffer: Buffer): Promise<{
    isValid: boolean;
    version?: string;
    pageCount?: number;
    errors?: string[];
  }> {
    const errors: string[] = [];

    try {
      // Check header
      const header = buffer.subarray(0, 8).toString('ascii');
      if (!header.startsWith('%PDF-')) {
        errors.push('Invalid PDF header');
        return { isValid: false, errors };
      }

      // Extract version
      const versionMatch = header.match(/%PDF-(\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : 'unknown';

      // Check for EOF marker
      const footer = buffer.subarray(-100).toString('ascii');
      if (!footer.includes('%%EOF')) {
        errors.push('Missing EOF marker');
      }

      // Basic structure checks
      const content = buffer.toString('ascii', 0, Math.min(10000, buffer.length));

      if (!content.includes('obj')) {
        errors.push('No objects found');
      }

      if (!content.includes('stream') && !content.includes('xref')) {
        errors.push('No streams or xref found');
      }

      return {
        isValid: errors.length === 0,
        version,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`Validation error: ${error.message}`]
      };
    }
  }
}