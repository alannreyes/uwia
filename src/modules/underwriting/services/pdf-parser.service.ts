import { Injectable, Logger } from '@nestjs/common';
const pdfParse = require('pdf-parse');
const pdfjs = require('pdfjs-dist/legacy/build/pdf');

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);

  async extractText(buffer: Buffer): Promise<string> {
    this.logger.log('Iniciando extracción de texto del PDF con múltiples métodos');
    
    // MÉTODO 1: pdf-parse (más simple)
    try {
      this.logger.log('📄 Método 1: Usando pdf-parse');
      const data = await pdfParse(buffer);
      const extractedText = data.text?.trim() || '';
      
      if (extractedText && extractedText.length > 0) {
        this.logger.log(`✅ pdf-parse exitoso: ${extractedText.length} caracteres`);
        return extractedText;
      }
      
      this.logger.warn('⚠️ pdf-parse no extrajo texto, intentando método 2');
    } catch (error) {
      this.logger.warn(`⚠️ pdf-parse falló: ${error.message}, intentando método 2`);
    }

    // MÉTODO 2: pdfjs-dist (más robusto)
    try {
      this.logger.log('📄 Método 2: Usando pdfjs-dist');
      const extractedText = await this.extractWithPdfJs(buffer);
      
      if (extractedText && extractedText.length > 0) {
        this.logger.log(`✅ pdfjs-dist exitoso: ${extractedText.length} caracteres`);
        return extractedText;
      }
      
      this.logger.warn('⚠️ pdfjs-dist no extrajo texto');
    } catch (error) {
      this.logger.warn(`⚠️ pdfjs-dist falló: ${error.message}`);
    }

    // MÉTODO 3: Análisis de metadatos (último recurso)
    try {
      this.logger.log('📄 Método 3: Extrayendo metadatos básicos');
      const basicInfo = await this.extractBasicInfo(buffer);
      
      if (basicInfo && basicInfo.length > 0) {
        this.logger.log(`✅ Metadatos extraídos: ${basicInfo.length} caracteres`);
        return basicInfo;
      }
    } catch (error) {
      this.logger.warn(`⚠️ Extracción de metadatos falló: ${error.message}`);
    }

    // Si todos los métodos fallan
    this.logger.error('❌ TODOS los métodos de extracción fallaron');
    throw new Error('No se pudo extraer texto del PDF con ningún método disponible');
  }

  async extractTextFromBase64(base64Content: string): Promise<string> {
    try {
      // Limpiar header de base64 si existe
      const cleanBase64 = base64Content.replace(/^data:application\/pdf;base64,/, '');
      
      // Convertir base64 a buffer
      const buffer = Buffer.from(cleanBase64, 'base64');
      
      return await this.extractText(buffer);
    } catch (error) {
      this.logger.error('Error extrayendo texto de contenido base64:', error.message);
      throw new Error(`Error al procesar PDF desde base64: ${error.message}`);
    }
  }

  /**
   * MÉTODO 2: Extracción usando pdfjs-dist (más robusto)
   */
  private async extractWithPdfJs(buffer: Buffer): Promise<string> {
    try {
      const loadingTask = pdfjs.getDocument({
        data: buffer,
        useSystemFonts: true,
        disableFontFace: false,
        verbosity: 0
      });

      const pdf = await loadingTask.promise;
      let fullText = '';

      // Extraer texto de todas las páginas
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
          
          if (pageText.trim()) {
            fullText += `${pageText}\n`;
          }
          
          // Cleanup de la página
          page.cleanup();
        } catch (pageError) {
          this.logger.warn(`⚠️ Error en página ${pageNum}: ${pageError.message}`);
          continue;
        }
      }

      // Cleanup del documento
      pdf.destroy();
      
      return fullText.trim();
    } catch (error) {
      throw new Error(`pdfjs-dist extraction failed: ${error.message}`);
    }
  }

  /**
   * MÉTODO 3: Extracción básica de metadatos (último recurso)
   */
  private async extractBasicInfo(buffer: Buffer): Promise<string> {
    try {
      // Intentar extraer información básica del PDF
      const pdfString = buffer.toString('latin1');
      
      // Buscar patrones comunes en PDFs
      const patterns = [
        /\/Title\s*\(([^)]+)\)/g,
        /\/Subject\s*\(([^)]+)\)/g,
        /\/Author\s*\(([^)]+)\)/g,
        /\/Creator\s*\(([^)]+)\)/g,
        /\/Producer\s*\(([^)]+)\)/g,
        // Buscar texto entre stream y endstream
        /stream\s*([\s\S]*?)\s*endstream/g,
        // Buscar BT...ET (text objects)
        /BT\s*([\s\S]*?)\s*ET/g
      ];

      let extractedInfo = '';
      
      patterns.forEach(pattern => {
        const matches = pdfString.match(pattern);
        if (matches) {
          matches.forEach(match => {
            const cleaned = match
              .replace(/\/\w+\s*\(/, '')
              .replace(/\)/, '')
              .replace(/stream\s*/, '')
              .replace(/\s*endstream/, '')
              .replace(/BT\s*/, '')
              .replace(/\s*ET/, '')
              .trim();
            
            if (cleaned && cleaned.length > 3) {
              extractedInfo += `${cleaned} `;
            }
          });
        }
      });

      return extractedInfo.trim();
    } catch (error) {
      throw new Error(`Basic info extraction failed: ${error.message}`);
    }
  }
}