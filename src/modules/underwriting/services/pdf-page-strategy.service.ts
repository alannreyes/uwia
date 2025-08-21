import { Injectable, Logger } from '@nestjs/common';
import { PdfImageService } from './pdf-image.service';

/**
 * Servicio para determinar estrategias inteligentes de conversión de páginas PDF
 * Optimiza el análisis según el tipo de pregunta y ubicación típica de información
 */
@Injectable()
export class PdfPageStrategyService {
  private readonly logger = new Logger(PdfPageStrategyService.name);

  constructor(
    private readonly pdfImageService: PdfImageService,
  ) {}

  /**
   * Convierte páginas de PDF con estrategia inteligente de reintentos
   * Si falla la conversión múltiple, intenta páginas individuales clave
   */
  async convertPagesWithStrategy(
    pdfBase64: string,
    pmcField?: string,
    maxAttempts: number = 3
  ): Promise<Map<number, string>> {
    const imageMap = new Map<number, string>();
    
    // Determinar páginas prioritarias según el campo
    const priorityPages = this.determinePriorityPages(pmcField);
    
    this.logger.log(`📄 Estrategia de conversión para ${pmcField || 'general'}: páginas ${priorityPages.join(', ')}`);
    
    // Intento 1: Convertir todas las páginas prioritarias de una vez
    try {
      const fullConversion = await this.pdfImageService.convertPages(pdfBase64, priorityPages);
      if (fullConversion.size > 0) {
        this.logger.log(`✅ Conversión exitosa: ${fullConversion.size} páginas`);
        return fullConversion;
      }
    } catch (error) {
      this.logger.warn(`⚠️ Fallo conversión múltiple: ${error.message}`);
    }
    
    // Intento 2: Convertir páginas individualmente en orden de prioridad
    for (const pageNum of priorityPages) {
      try {
        this.logger.log(`🔄 Intentando página individual: ${pageNum}`);
        const singlePageImage = await this.pdfImageService.convertSinglePage(
          Buffer.from(pdfBase64, 'base64'),
          pageNum
        );
        
        if (singlePageImage) {
          imageMap.set(pageNum, singlePageImage);
          this.logger.log(`✅ Página ${pageNum} convertida exitosamente`);
          
          // Para firmas, si encontramos una página, intentar la anterior y siguiente
          if (pmcField && pmcField.includes('sign')) {
            await this.tryAdjacentPages(pdfBase64, pageNum, imageMap);
          }
        }
      } catch (pageError) {
        this.logger.warn(`⚠️ No se pudo convertir página ${pageNum}: ${pageError.message}`);
      }
    }
    
    // Intento 3: Si no tenemos ninguna imagen y es crítico, intentar páginas de emergencia
    if (imageMap.size === 0) {
      this.logger.warn('🆘 Sin imágenes - intentando páginas de emergencia');
      const emergencyPages = [1, 2]; // Primera y segunda página como mínimo
      
      for (const pageNum of emergencyPages) {
        if (!imageMap.has(pageNum)) {
          try {
            const emergencyImage = await this.pdfImageService.convertSinglePage(
              Buffer.from(pdfBase64, 'base64'),
              pageNum
            );
            if (emergencyImage) {
              imageMap.set(pageNum, emergencyImage);
              this.logger.log(`🆘 Página de emergencia ${pageNum} convertida`);
            }
          } catch (e) {
            // Silenciar error, ya es el último intento
          }
        }
      }
    }
    
    this.logger.log(`📊 Resultado final: ${imageMap.size} páginas convertidas: [${Array.from(imageMap.keys()).join(', ')}]`);
    return imageMap;
  }

  /**
   * Determina qué páginas son prioritarias según el campo PMC
   */
  private determinePriorityPages(pmcField?: string): number[] {
    if (!pmcField) {
      // Por defecto: primeras páginas y última (donde suelen estar firmas)
      return [1, 2, 3, -1]; // -1 significa última página
    }
    
    const fieldLower = pmcField.toLowerCase();
    
    // Patrones y sus páginas típicas
    if (fieldLower.includes('sign') || fieldLower.includes('lop_date')) {
      // Firmas y fechas de firma: típicamente al final
      return [2, 1, 3, -1, -2]; // Página 2 primero (común en LOPs), luego 1, 3, última, penúltima
    }
    
    if (fieldLower.includes('address') || fieldLower.includes('street') || 
        fieldLower.includes('city') || fieldLower.includes('zip')) {
      // Información de dirección: típicamente al inicio
      return [1, 2];
    }
    
    if (fieldLower.includes('policy') || fieldLower.includes('claim')) {
      // Información de póliza: primera página generalmente
      return [1, 2];
    }
    
    if (fieldLower.includes('date_of_loss')) {
      // Fecha de pérdida: puede estar en cualquier lugar
      return [1, 2, 3];
    }
    
    // Por defecto para campos no reconocidos
    return [1, 2, 3];
  }

  /**
   * Intenta convertir páginas adyacentes si es necesario
   */
  private async tryAdjacentPages(
    pdfBase64: string,
    currentPage: number,
    imageMap: Map<number, string>
  ): Promise<void> {
    const adjacentPages = [currentPage - 1, currentPage + 1].filter(p => p > 0);
    
    for (const pageNum of adjacentPages) {
      if (!imageMap.has(pageNum)) {
        try {
          const adjacentImage = await this.pdfImageService.convertSinglePage(
            Buffer.from(pdfBase64, 'base64'),
            pageNum
          );
          if (adjacentImage) {
            imageMap.set(pageNum, adjacentImage);
            this.logger.log(`📄 Página adyacente ${pageNum} también convertida`);
          }
        } catch (e) {
          // Silenciar, es opcional
        }
      }
    }
  }

  /**
   * Obtiene el número total de páginas de un PDF
   */
  async getTotalPages(pdfBase64: string): Promise<number> {
    try {
      // Intentar obtener el conteo de páginas del PDF
      // Esto debería implementarse en PdfImageService
      const buffer = Buffer.from(pdfBase64, 'base64');
      // Por ahora retornar un estimado conservador
      return 5;
    } catch (error) {
      this.logger.warn(`No se pudo determinar el número de páginas: ${error.message}`);
      return 5; // Asumir 5 páginas por defecto
    }
  }
}