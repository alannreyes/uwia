import { Injectable, Logger } from '@nestjs/common';
const pdfParse = require('pdf-parse');

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);

  async extractText(buffer: Buffer): Promise<string> {
    try {
      this.logger.log('Iniciando extracción de texto del PDF');
      
      const data = await pdfParse(buffer);
      const extractedText = data.text.trim();
      
      this.logger.log(`Texto extraído: ${extractedText.length} caracteres`);
      
      // Validar que se extrajo contenido
      if (!extractedText || extractedText.length === 0) {
        throw new Error('No se pudo extraer texto del PDF');
      }
      
      // Limpiar el buffer de memoria
      buffer = null;
      
      return extractedText;
    } catch (error) {
      this.logger.error('Error extrayendo texto del PDF:', error.message);
      
      // Limpiar el buffer incluso en caso de error
      buffer = null;
      
      throw new Error(`Error al procesar PDF: ${error.message}`);
    }
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
}