import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';

export interface PageAnalysis {
  pageNumber: number;
  contentType: 'declarations' | 'coverage' | 'exclusions' | 'signatures' | 'schedules' | 'endorsements' | 'general';
  hasSignatures: boolean;
  hasDates: boolean;
  hasPolicyNumbers: boolean;
  hasMonetaryAmounts: boolean;
  keywordDensity: {[keyword: string]: number};
  confidence: number;
}

export interface FieldPageMapping {
  field: string;
  targetPages: number[];
  reasoning: string;
  confidence: number;
}

@Injectable()
export class IntelligentPageSelectorService {
  private readonly logger = new Logger(IntelligentPageSelectorService.name);

  constructor(private readonly geminiService: GeminiService) {}

  /**
   * MAGIC: Identifica páginas relevantes para cada campo usando AI
   * Reduce 93MB → procesamiento selectivo inteligente
   */
  async identifyRelevantPagesForFields(
    images: Buffer[], 
    prompts: Array<{pmc_field: string, question: string}>
  ): Promise<{[field: string]: FieldPageMapping}> {

    this.logger.log(`🎯 Starting intelligent page targeting for ${images.length} pages, ${prompts.length} fields`);

    try {
      // FASE 1: Quick scan de todas las páginas para clasificación
      const pageAnalysis = await this.quickScanAllPages(images);
      
      // FASE 2: Mapear cada campo a páginas específicas usando AI + heurísticas
      const fieldMappings: {[field: string]: FieldPageMapping} = {};
      
      for (const prompt of prompts) {
        const mapping = await this.determineOptimalPages(
          prompt, 
          pageAnalysis, 
          images.length
        );
        fieldMappings[prompt.pmc_field] = mapping;
      }

      this.logMappingSummary(fieldMappings);
      return fieldMappings;

    } catch (error) {
      this.logger.error(`❌ Page targeting failed: ${error.message}`);
      
      // Fallback inteligente: usar heurísticas sin AI
      return this.fallbackPageMapping(prompts, images.length);
    }
  }

  /**
   * Quick scan usando Gemini Vision - 1 request para todas las páginas
   */
  private async quickScanAllPages(images: Buffer[]): Promise<PageAnalysis[]> {
    
    this.logger.log(`🔍 Quick scanning ${images.length} pages for content classification`);

    // Para PDFs muy grandes, hacer muestreo inteligente
    const samplesToAnalyze = this.selectSamplePages(images);
    
    const analysisPrompt = `Analyze these document pages and classify each one. For each page, identify:

1. Content type: declarations, coverage, exclusions, signatures, schedules, endorsements, or general
2. Has signatures: true/false (handwritten marks, signature lines)  
3. Has dates: true/false (any date format)
4. Has policy numbers: true/false (alphanumeric identifiers)
5. Has monetary amounts: true/false ($, amounts, premiums)
6. Key phrases found (up to 5 most important)

Respond with JSON array format:
[
  {
    "page": 1,
    "contentType": "declarations",
    "hasSignatures": false,
    "hasDates": true,
    "hasPolicyNumbers": true,
    "hasMonetaryAmounts": true,
    "keyPhrases": ["policy period", "effective date", "premium", "insured", "coverage"]
  }
]`;

    try {
      // Usar solo la primera imagen del sample para el análisis
      const firstImageBase64 = samplesToAnalyze[0].image.toString('base64');
      const analysisResult = await this.geminiService.analyzeWithVision(
        firstImageBase64,
        analysisPrompt,
        'text' as any, // tipo de respuesta esperada
        'page_classification',
        1
      );

      // Parsear respuesta JSON y expandir a todas las páginas
      const parsedAnalysis = this.parseAndExpandAnalysis(
        analysisResult.response, 
        samplesToAnalyze,
        images.length
      );

      this.logger.log(`✅ Quick scan completed: found ${parsedAnalysis.filter(p => p.contentType !== 'general').length} specialized pages`);
      return parsedAnalysis;

    } catch (error) {
      this.logger.warn(`⚠️ Quick scan failed, using heuristic analysis: ${error.message}`);
      return this.heuristicPageAnalysis(images);
    }
  }

  /**
   * Selecciona páginas de muestra para análisis eficiente
   */
  private selectSamplePages(images: Buffer[]): Array<{pageNumber: number, image: Buffer}> {
    const totalPages = images.length;
    
    if (totalPages <= 10) {
      return images.map((img, i) => ({pageNumber: i + 1, image: img}));
    }

    // Para documentos grandes: muestra estratégica
    const samples = [];
    
    // Primeras 3 páginas (declaraciones típicamente)
    for (let i = 0; i < Math.min(3, totalPages); i++) {
      samples.push({pageNumber: i + 1, image: images[i]});
    }
    
    // Páginas del medio (cada 25% aproximadamente)
    const quarterPoints = [
      Math.floor(totalPages * 0.25),
      Math.floor(totalPages * 0.50),
      Math.floor(totalPages * 0.75)
    ];
    
    for (const point of quarterPoints) {
      if (point < totalPages && point >= 3) {
        samples.push({pageNumber: point + 1, image: images[point]});
      }
    }
    
    // Últimas 2 páginas (firmas típicamente)
    for (let i = Math.max(totalPages - 2, samples.length); i < totalPages; i++) {
      samples.push({pageNumber: i + 1, image: images[i]});
    }

    this.logger.debug(`📊 Selected ${samples.length} sample pages from ${totalPages} total pages`);
    return samples;
  }

  /**
   * Determina páginas óptimas para un campo específico
   */
  private async determineOptimalPages(
    prompt: {pmc_field: string, question: string},
    pageAnalysis: PageAnalysis[],
    totalPages: number
  ): Promise<FieldPageMapping> {

    // Análisis semántico del campo usando patrones conocidos
    const fieldType = this.classifyFieldType(prompt);
    const targetPages = this.findPagesForFieldType(fieldType, pageAnalysis, totalPages);
    
    const mapping: FieldPageMapping = {
      field: prompt.pmc_field,
      targetPages: targetPages.slice(0, 5), // Máximo 5 páginas por campo
      reasoning: this.generateReasoning(fieldType, targetPages, pageAnalysis),
      confidence: this.calculateMappingConfidence(fieldType, targetPages, pageAnalysis)
    };

    this.logger.debug(`🎯 ${prompt.pmc_field} → pages ${mapping.targetPages.join(', ')} (${fieldType}, confidence: ${mapping.confidence})`);
    
    return mapping;
  }

  /**
   * Clasifica el tipo de campo basado en patrones
   */
  private classifyFieldType(prompt: {pmc_field: string, question: string}): string {
    const field = prompt.pmc_field.toLowerCase();
    const question = prompt.question.toLowerCase();
    
    // Patrones de clasificación inteligente
    if (field.includes('sign') || question.includes('signature') || question.includes('signed')) {
      return 'signatures';
    }
    
    if (field.includes('date') || question.includes('date') || field.includes('effective') || field.includes('expir')) {
      return 'dates';
    }
    
    if (field.includes('policy') && (field.includes('valid') || field.includes('start') || field.includes('effective'))) {
      return 'policy_period';
    }
    
    if (field.includes('exclusion') || question.includes('exclusion')) {
      return 'exclusions';
    }
    
    if (field.includes('cover') || question.includes('coverage') || question.includes('cover')) {
      return 'coverage';
    }
    
    if (field.includes('name') || field.includes('insured') || field.includes('company')) {
      return 'insured_info';
    }
    
    if (field.includes('policy_number') || field.includes('claim_number')) {
      return 'policy_identifiers';
    }
    
    if (field.includes('comprehensive') || question.includes('go through the document')) {
      return 'comprehensive';
    }
    
    return 'general';
  }

  /**
   * Encuentra páginas específicas para cada tipo de campo
   */
  private findPagesForFieldType(
    fieldType: string, 
    pageAnalysis: PageAnalysis[], 
    totalPages: number
  ): number[] {
    
    switch (fieldType) {
      case 'signatures':
        // Buscar páginas con firmas, típicamente al final
        const signaturePages = pageAnalysis
          .filter(p => p.hasSignatures)
          .map(p => p.pageNumber);
        
        if (signaturePages.length > 0) return signaturePages;
        
        // Fallback: últimas 3 páginas
        return Array.from({length: Math.min(3, totalPages)}, (_, i) => totalPages - i);

      case 'dates':
      case 'policy_period':
      case 'insured_info':
      case 'policy_identifiers':
        // Buscar en declaraciones (primeras páginas) + páginas con fechas/números
        const declarationPages = pageAnalysis
          .filter(p => p.contentType === 'declarations' || p.hasDates || p.hasPolicyNumbers)
          .map(p => p.pageNumber)
          .slice(0, 4);
        
        if (declarationPages.length > 0) return declarationPages;
        
        // Fallback: primeras 3 páginas
        return [1, 2, 3].filter(p => p <= totalPages);

      case 'exclusions':
        // Buscar páginas de exclusiones específicamente
        const exclusionPages = pageAnalysis
          .filter(p => p.contentType === 'exclusions')
          .map(p => p.pageNumber);
        
        if (exclusionPages.length > 0) return exclusionPages;
        
        // Fallback: páginas del medio del documento
        const midStart = Math.floor(totalPages * 0.3);
        const midEnd = Math.floor(totalPages * 0.7);
        return Array.from({length: Math.min(5, midEnd - midStart + 1)}, (_, i) => midStart + i);

      case 'coverage':
        // Buscar páginas de cobertura + declaraciones
        const coveragePages = pageAnalysis
          .filter(p => p.contentType === 'coverage' || p.contentType === 'declarations')
          .map(p => p.pageNumber)
          .slice(0, 6);
        
        if (coveragePages.length > 0) return coveragePages;
        
        // Fallback: primeras páginas + alguna del medio
        return [1, 2, 3, Math.floor(totalPages / 2)].filter(p => p <= totalPages);

      case 'comprehensive':
        // Para análisis comprensivo: muestra representativa
        const keyPages = [];
        
        // Primeras 2 páginas
        keyPages.push(1, 2);
        
        // Páginas especializadas si existen
        const specializedPages = pageAnalysis
          .filter(p => p.contentType !== 'general')
          .map(p => p.pageNumber)
          .slice(0, 3);
        keyPages.push(...specializedPages);
        
        // Última página
        keyPages.push(totalPages);
        
        return [...new Set(keyPages)].filter(p => p <= totalPages);

      default:
        // Para campos generales: estrategia balanceada
        return [1, Math.ceil(totalPages / 2), totalPages];
    }
  }

  /**
   * Genera explicación del razonamiento para debugging
   */
  private generateReasoning(
    fieldType: string, 
    targetPages: number[], 
    pageAnalysis: PageAnalysis[]
  ): string {
    const pagesWithTypes = targetPages.map(pageNum => {
      const analysis = pageAnalysis.find(p => p.pageNumber === pageNum);
      return `p${pageNum}(${analysis?.contentType || 'unknown'})`;
    }).join(', ');
    
    return `${fieldType} field → targeting ${pagesWithTypes}`;
  }

  /**
   * Calcula confianza del mapeo
   */
  private calculateMappingConfidence(
    fieldType: string, 
    targetPages: number[], 
    pageAnalysis: PageAnalysis[]
  ): number {
    let confidence = 0.5; // Base confidence
    
    // Aumentar confianza si encontramos páginas especializadas
    const relevantPages = targetPages.filter(pageNum => {
      const analysis = pageAnalysis.find(p => p.pageNumber === pageNum);
      return analysis && analysis.contentType !== 'general';
    });
    
    confidence += relevantPages.length * 0.1;
    
    // Bonus por match específico de tipo
    const perfectMatches = targetPages.filter(pageNum => {
      const analysis = pageAnalysis.find(p => p.pageNumber === pageNum);
      return analysis && (
        (fieldType === 'signatures' && analysis.hasSignatures) ||
        (fieldType === 'dates' && analysis.hasDates) ||
        (fieldType === 'policy_identifiers' && analysis.hasPolicyNumbers)
      );
    });
    
    confidence += perfectMatches.length * 0.2;
    
    return Math.min(1.0, confidence);
  }

  /**
   * Parsea respuesta de AI y expande a todas las páginas
   */
  private parseAndExpandAnalysis(
    aiResponse: string, 
    samples: Array<{pageNumber: number, image: Buffer}>,
    totalPages: number
  ): PageAnalysis[] {
    
    try {
      const parsed = JSON.parse(aiResponse);
      const analysis: PageAnalysis[] = [];
      
      // Crear análisis para páginas muestreadas
      const sampleAnalysis = new Map<number, PageAnalysis>();
      
      for (const item of parsed) {
        if (item.page && item.contentType) {
          sampleAnalysis.set(item.page, {
            pageNumber: item.page,
            contentType: item.contentType,
            hasSignatures: item.hasSignatures || false,
            hasDates: item.hasDates || false,
            hasPolicyNumbers: item.hasPolicyNumbers || false,
            hasMonetaryAmounts: item.hasMonetaryAmounts || false,
            keywordDensity: this.extractKeywordDensity(item.keyPhrases || []),
            confidence: 0.8
          });
        }
      }
      
      // Expandir análisis a todas las páginas usando interpolación
      for (let i = 1; i <= totalPages; i++) {
        if (sampleAnalysis.has(i)) {
          analysis.push(sampleAnalysis.get(i));
        } else {
          // Interpolar basado en página más cercana analizada
          const nearestSample = this.findNearestAnalyzedPage(i, sampleAnalysis);
          analysis.push({
            pageNumber: i,
            contentType: nearestSample?.contentType || 'general',
            hasSignatures: nearestSample?.hasSignatures || false,
            hasDates: nearestSample?.hasDates || false,
            hasPolicyNumbers: nearestSample?.hasPolicyNumbers || false,
            hasMonetaryAmounts: nearestSample?.hasMonetaryAmounts || false,
            keywordDensity: {},
            confidence: 0.3 // Menor confianza para páginas interpoladas
          });
        }
      }
      
      return analysis;
      
    } catch (error) {
      this.logger.warn(`⚠️ Failed to parse AI analysis, using heuristics: ${error.message}`);
      return this.heuristicPageAnalysis(samples.map(s => s.image));
    }
  }

  /**
   * Encuentra página analizada más cercana para interpolación
   */
  private findNearestAnalyzedPage(
    targetPage: number, 
    sampleAnalysis: Map<number, PageAnalysis>
  ): PageAnalysis | null {
    let minDistance = Infinity;
    let nearest = null;
    
    for (const [pageNum, analysis] of sampleAnalysis) {
      const distance = Math.abs(pageNum - targetPage);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = analysis;
      }
    }
    
    return nearest;
  }

  /**
   * Análisis heurístico como fallback
   */
  private heuristicPageAnalysis(images: Buffer[]): PageAnalysis[] {
    const totalPages = images.length;
    const analysis: PageAnalysis[] = [];
    
    for (let i = 1; i <= totalPages; i++) {
      let contentType: PageAnalysis['contentType'] = 'general';
      
      // Heurísticas basadas en posición
      if (i <= 3) {
        contentType = 'declarations';
      } else if (i > totalPages - 3) {
        contentType = 'signatures';
      } else if (i > totalPages * 0.3 && i < totalPages * 0.7) {
        contentType = 'coverage';
      }
      
      analysis.push({
        pageNumber: i,
        contentType,
        hasSignatures: i > totalPages - 3, // Últimas páginas probablemente tienen firmas
        hasDates: i <= 5, // Primeras páginas probablemente tienen fechas
        hasPolicyNumbers: i <= 3, // Primeras páginas tienen números de póliza
        hasMonetaryAmounts: i <= 5 || (i > totalPages * 0.2 && i < totalPages * 0.8),
        keywordDensity: {},
        confidence: 0.4 // Baja confianza para heurísticas
      });
    }
    
    return analysis;
  }

  /**
   * Extrae densidad de palabras clave
   */
  private extractKeywordDensity(keyPhrases: string[]): {[keyword: string]: number} {
    const density: {[keyword: string]: number} = {};
    
    for (const phrase of keyPhrases) {
      if (typeof phrase === 'string') {
        density[phrase.toLowerCase()] = 1;
      }
    }
    
    return density;
  }

  /**
   * Fallback cuando falla el análisis AI
   */
  private fallbackPageMapping(
    prompts: Array<{pmc_field: string, question: string}>, 
    totalPages: number
  ): {[field: string]: FieldPageMapping} {
    
    this.logger.warn('🔄 Using fallback heuristic page mapping');
    
    const mappings: {[field: string]: FieldPageMapping} = {};
    
    for (const prompt of prompts) {
      const fieldType = this.classifyFieldType(prompt);
      let targetPages: number[];
      
      switch (fieldType) {
        case 'signatures':
          targetPages = [totalPages - 1, totalPages]; // Últimas 2 páginas
          break;
        case 'dates':
        case 'policy_period':
        case 'insured_info':
        case 'policy_identifiers':
          targetPages = [1, 2, 3]; // Primeras 3 páginas
          break;
        case 'comprehensive':
          targetPages = [1, Math.ceil(totalPages / 2), totalPages]; // Muestra representativa
          break;
        default:
          targetPages = [1, totalPages]; // Primera y última página
          break;
      }
      
      mappings[prompt.pmc_field] = {
        field: prompt.pmc_field,
        targetPages: targetPages.filter(p => p <= totalPages),
        reasoning: `Fallback heuristic for ${fieldType}`,
        confidence: 0.3
      };
    }
    
    return mappings;
  }

  /**
   * Log resumen del mapeo para debugging
   */
  private logMappingSummary(fieldMappings: {[field: string]: FieldPageMapping}): void {
    this.logger.log(`📋 Page targeting summary:`);
    
    for (const [field, mapping] of Object.entries(fieldMappings)) {
      this.logger.log(`   ${field}: pages [${mapping.targetPages.join(', ')}] confidence=${mapping.confidence.toFixed(2)}`);
    }
    
    const totalPagesTarget = new Set(
      Object.values(fieldMappings).flatMap(m => m.targetPages)
    ).size;
    
    this.logger.log(`🎯 Targeting ${totalPagesTarget} unique pages for processing optimization`);
  }
}