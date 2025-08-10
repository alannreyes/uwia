import { Injectable, Logger } from '@nestjs/common';
import { pdfToPng } from 'pdf-to-png-converter';

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
    const startTime = Date.now();
    try {
      this.logger.log(`🖼️ Converting ${pageNumbers.length} pages to images (timeout: 120s)`);
      
      // Limpiar header de base64 si existe
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      const pdfBuffer = Buffer.from(cleanBase64, 'base64');
      
      // Configuración de conversión para pdf-to-png-converter
      const options = {
        viewportScale: 2.0,           // Escala para buena resolución
        pagesToProcess: pageNumbers,  // Páginas específicas a convertir
        strictPagesToProcess: false,  // Permisivo con páginas no existentes
        verbosityLevel: 0            // Sin logs verbosos
      };
      
      // Convertir páginas usando pdfToPng con timeout
      const conversionPromise = pdfToPng(pdfBuffer, options);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('PDF to PNG conversion timeout (120s)')), 120000);
      });
      
      this.logger.log(`⏱️ Starting conversion with 120s timeout...`);
      const pngPages = await Promise.race([conversionPromise, timeoutPromise]);
      
      // Crear mapa de página -> imagen base64
      const imageMap = new Map<number, string>();
      
      pngPages.forEach((page) => {
        // La librería devuelve objetos con propiedades pageNumber y content (Buffer)
        const pageNum = page.pageNumber;
        const base64 = page.content.toString('base64');
        imageMap.set(pageNum, base64);
        this.logger.log(`✅ Page ${pageNum} converted: ${base64.length} chars`);
      });
      
      const elapsed = Date.now() - startTime;
      this.logger.log(`🎉 Conversion completed in ${elapsed}ms`);
      
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