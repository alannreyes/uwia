import { Injectable, Logger } from '@nestjs/common';
import { pdf2png } from 'pdf-to-png-converter';

@Injectable()
export class PdfImageService {
  private readonly logger = new Logger(PdfImageService.name);

  /**
   * Convierte páginas específicas de un PDF a imágenes
   */
  async convertPages(
    pdfBase64: string, 
    pageNumbers: number[] = [1]
  ): Promise<Map<number, string>> {
    try {
      this.logger.log(`Converting ${pageNumbers.length} pages to images`);
      
      // Limpiar header de base64 si existe
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      const pdfBuffer = Buffer.from(cleanBase64, 'base64');
      
      // Configuración de conversión
      const options = {
        density: 150,           // DPI para buena calidad sin ser excesivo
        width: 1200,           // Ancho fijo para consistencia
        height: 1600,          // Alto máximo
        quality: 85,           // Calidad JPEG
        outputFormat: 'png',   // PNG para mejor calidad en firmas
        pages: pageNumbers     // Páginas específicas
      };
      
      // Convertir páginas
      const images = await pdf2png(pdfBuffer, options);
      
      // Crear mapa de página -> imagen base64
      const imageMap = new Map<number, string>();
      
      images.forEach((image, index) => {
        const pageNum = pageNumbers[index];
        // La librería devuelve el buffer, convertir a base64
        const base64 = image.toString('base64');
        imageMap.set(pageNum, base64);
        this.logger.log(`Page ${pageNum} converted: ${base64.length} chars`);
      });
      
      return imageMap;
      
    } catch (error) {
      this.logger.error('Error converting PDF to images:', error);
      throw new Error(`Failed to convert PDF to images: ${error.message}`);
    }
  }

  /**
   * Convierte solo la primera página (común para firmas)
   */
  async convertFirstPage(pdfBase64: string): Promise<string> {
    const images = await this.convertPages(pdfBase64, [1]);
    return images.get(1) || '';
  }

  /**
   * Convierte primera y última página (firmas suelen estar ahí)
   */
  async convertSignaturePages(pdfBase64: string): Promise<Map<number, string>> {
    try {
      // Primero necesitamos saber cuántas páginas tiene el PDF
      const pageCount = await this.getPageCount(pdfBase64);
      
      const pagesToConvert = [1]; // Primera página siempre
      if (pageCount > 1) {
        pagesToConvert.push(pageCount); // Última página si hay más de una
      }
      
      return await this.convertPages(pdfBase64, pagesToConvert);
    } catch (error) {
      // Si falla obtener páginas, al menos convertir la primera
      this.logger.warn('Could not determine page count, converting first page only');
      return await this.convertPages(pdfBase64, [1]);
    }
  }

  /**
   * Obtiene el número de páginas del PDF
   */
  private async getPageCount(pdfBase64: string): Promise<number> {
    try {
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      const pdfBuffer = Buffer.from(cleanBase64, 'base64');
      
      // pdf-parse puede darnos esta info
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(pdfBuffer);
      
      return data.numpages || 1;
    } catch (error) {
      this.logger.error('Error getting page count:', error);
      return 1; // Asumir 1 página si falla
    }
  }
}