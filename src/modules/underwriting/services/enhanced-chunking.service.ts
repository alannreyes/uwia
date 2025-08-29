import { Injectable, Logger } from '@nestjs/common';
import { estimateGeminiTokens } from '../../../config/gemini.config';

interface DocumentMetadata {
  id: string;
  size: number;
  type: string;
  complexity?: 'simple' | 'medium' | 'complex';
}

interface ChunkResult {
  chunks: Array<{
    id: string;
    content: string;
    position: number;
    size: number;
    priority: 'critical' | 'high' | 'medium' | 'low';
    estimatedTokens: number;
    metadata: {
      hasTable: boolean;
      hasNumbers: boolean;
      hasLegalTerms: boolean;
      section: string;
      chunkType: 'header' | 'content' | 'footer' | 'table' | 'summary';
    };
  }>;
  strategy: 'none' | 'smart' | 'aggressive' | 'semantic' | 'emergency';
  totalChunks: number;
  estimatedProcessingTime: number;
  recommendedModel: 'gemini' | 'gpt-5' | 'mixed';
}

@Injectable()
export class EnhancedChunkingService {
  private readonly logger = new Logger(EnhancedChunkingService.name);
  
  // Caché LRU para chunks procesados
  private chunkCache = new Map<string, ChunkResult>();
  private readonly MAX_CACHE_SIZE = 50; // 50 documentos en caché
  
  // Configuración de estrategias de chunking
  private readonly CHUNK_STRATEGIES = {
    NONE: {
      maxSize: 5 * 1024 * 1024,        // 5MB
      description: 'Procesamiento directo sin chunking'
    },
    SMART: {
      minSize: 5 * 1024 * 1024,        // 5MB
      maxSize: 25 * 1024 * 1024,       // 25MB
      chunkSize: 800000,                // 800K chars (~200K tokens)
      overlap: 15000,                   // 15K chars overlap
      description: 'Chunking inteligente con overlap semántico'
    },
    AGGRESSIVE: {
      minSize: 25 * 1024 * 1024,       // 25MB
      maxSize: 60 * 1024 * 1024,       // 60MB
      chunkSize: 600000,                // 600K chars (~150K tokens
      overlap: 10000,                   // 10K chars overlap
      maxParallel: 8,
      description: 'Chunking agresivo para documentos grandes'
    },
    SEMANTIC: {
      minSize: 60 * 1024 * 1024,       // 60MB
      maxSize: 100 * 1024 * 1024,      // 100MB
      dynamicChunkSize: true,
      minChunk: 300000,                 // 300K chars mínimo
      maxChunk: 1000000,                // 1M chars máximo (~250K tokens)
      description: 'Chunking semántico para documentos masivos'
    },
    EMERGENCY: {
      minSize: 100 * 1024 * 1024,      // >100MB
      description: 'Chunking de emergencia para documentos extremos'
    }
  };

  /**
   * Punto de entrada principal para chunking de documentos
   * Sigue el patrón de tu sistema actual pero mejorado para 100MB
   */
  async processDocument(
    content: string,
    documentId: string,
    metadata?: DocumentMetadata
  ): Promise<ChunkResult> {
    const startTime = Date.now();
    const contentHash = this.generateContentHash(content);
    
    // Verificar caché primero
    const cached = this.chunkCache.get(contentHash);
    if (cached) {
      this.logger.log(`📦 Usando chunks cacheados para documento ${documentId}`);
      return cached;
    }
    
    const sizeInBytes = Buffer.byteLength(content, 'utf8');
    const sizeInMB = sizeInBytes / (1024 * 1024);
    
    this.logger.log(`📄 Procesando documento: ${documentId} (${sizeInMB.toFixed(2)}MB)`);
    
    // Determinar estrategia de chunking
    const strategy = this.determineStrategy(sizeInMB);
    this.logger.log(`🎯 Estrategia seleccionada: ${strategy}`);
    
    let result: ChunkResult;
    
    try {
      switch (strategy) {
        case 'none':
          result = this.processDirectly(content, documentId);
          break;
        case 'smart':
          result = await this.smartChunking(content, documentId, metadata);
          break;
        case 'aggressive':
          result = await this.aggressiveChunking(content, documentId, metadata);
          break;
        case 'semantic':
          result = await this.semanticChunking(content, documentId, metadata);
          break;
        case 'emergency':
          result = await this.emergencyChunking(content, documentId, metadata);
          break;
        default:
          throw new Error(`Estrategia de chunking no soportada: ${strategy}`);
      }
      
      // Gestionar caché
      this.manageCacheSize();
      this.chunkCache.set(contentHash, result);
      
      const processingTime = Date.now() - startTime;
      this.logger.log(`✅ Chunking completado: ${result.totalChunks} chunks en ${processingTime}ms`);
      this.logger.log(`🤖 Modelo recomendado: ${result.recommendedModel}`);
      
      return result;
      
    } catch (error) {
      this.logger.error(`❌ Error en chunking: ${error.message}`);
      throw new Error(`Document chunking failed: ${error.message}`);
    }
  }

  /**
   * Determina la estrategia de chunking basada en el tamaño
   */
  private determineStrategy(sizeInMB: number): string {
    if (sizeInMB < 5) return 'none';
    if (sizeInMB < 25) return 'smart';
    if (sizeInMB < 60) return 'aggressive';
    if (sizeInMB <= 100) return 'semantic';
    return 'emergency';
  }

  /**
   * Procesamiento directo para documentos pequeños (<5MB)
   */
  private processDirectly(content: string, documentId: string): ChunkResult {
    const tokens = estimateGeminiTokens(content);
    
    return {
      chunks: [{
        id: `${documentId}-full`,
        content: content,
        position: 0,
        size: content.length,
        priority: 'critical',
        estimatedTokens: tokens,
        metadata: {
          hasTable: this.detectTables(content),
          hasNumbers: this.detectNumbers(content),
          hasLegalTerms: this.detectLegalTerms(content),
          section: 'complete_document',
          chunkType: 'content'
        }
      }],
      strategy: 'none',
      totalChunks: 1,
      estimatedProcessingTime: Math.min(5000, tokens * 0.1), // ~0.1ms por token
      recommendedModel: tokens > 200000 ? 'gemini' : 'gpt-5'
    };
  }

  /**
   * Chunking inteligente para documentos medianos (5-25MB)
   */
  private async smartChunking(
    content: string,
    documentId: string,
    metadata?: DocumentMetadata
  ): Promise<ChunkResult> {
    const config = this.CHUNK_STRATEGIES.SMART;
    const chunks = [];
    let chunkIndex = 0;
    
    // Identificar secciones críticas primero
    const criticalSections = this.identifyCriticalSections(content);
    
    // Procesar secciones críticas con prioridad
    for (const section of criticalSections) {
      if (section.content.length > 0) {
        chunks.push({
          id: `${documentId}-critical-${chunkIndex++}`,
          content: section.content,
          position: section.start,
          size: section.content.length,
          priority: 'critical' as const,
          estimatedTokens: estimateGeminiTokens(section.content),
          metadata: {
            hasTable: this.detectTables(section.content),
            hasNumbers: this.detectNumbers(section.content),
            hasLegalTerms: this.detectLegalTerms(section.content),
            section: section.name,
            chunkType: 'content' as const
          }
        });
      }
    }
    
    // Chunking regular del resto del documento
    let position = 0;
    while (position < content.length) {
      const endPosition = Math.min(position + config.chunkSize, content.length);
      
      // Ajustar límites en boundaries semánticos
      const adjustedEnd = this.findSemanticBoundary(content, position, endPosition);
      const chunkContent = content.substring(position, adjustedEnd);
      
      // Verificar si este chunk overlapa con secciones críticas ya procesadas
      const overlapsCritical = criticalSections.some(s => 
        this.hasOverlap(position, adjustedEnd, s.start, s.end)
      );
      
      if (!overlapsCritical && chunkContent.length > 1000) {
        chunks.push({
          id: `${documentId}-smart-${chunkIndex++}`,
          content: chunkContent,
          position: position,
          size: chunkContent.length,
          priority: 'medium' as const,
          estimatedTokens: estimateGeminiTokens(chunkContent),
          metadata: {
            hasTable: this.detectTables(chunkContent),
            hasNumbers: this.detectNumbers(chunkContent),
            hasLegalTerms: this.detectLegalTerms(chunkContent),
            section: this.identifySection(chunkContent),
            chunkType: 'content' as const
          }
        });
      }
      
      position = adjustedEnd - config.overlap;
      if (position >= content.length - config.overlap) break;
    }
    
    // Ordenar chunks por prioridad
    const sortedChunks = this.prioritizeChunks(chunks);
    
    return {
      chunks: sortedChunks,
      strategy: 'smart',
      totalChunks: sortedChunks.length,
      estimatedProcessingTime: sortedChunks.length * 4000,
      recommendedModel: 'mixed' // Usar ambos modelos según el contenido
    };
  }

  /**
   * Chunking agresivo para documentos grandes (25-60MB)
   */
  private async aggressiveChunking(
    content: string,
    documentId: string,
    metadata?: DocumentMetadata
  ): Promise<ChunkResult> {
    const config = this.CHUNK_STRATEGIES.AGGRESSIVE;
    const chunks = [];
    let chunkIndex = 0;
    
    this.logger.warn(`⚠️ Documento grande: ${(content.length / 1024 / 1024).toFixed(2)}MB - usando chunking agresivo`);
    
    // Pre-análisis para identificar densidad de contenido
    const densityMap = this.analyzeDensity(content);
    
    let position = 0;
    while (position < content.length) {
      // Determinar tamaño de chunk basado en densidad
      const density = this.getDensityAtPosition(densityMap, position);
      const adjustedChunkSize = this.adjustChunkSizeForDensity(config.chunkSize, density);
      
      const endPosition = Math.min(position + adjustedChunkSize, content.length);
      const chunkContent = content.substring(position, endPosition);
      
      if (chunkContent.length > 5000) { // Ignorar chunks muy pequeños
        const priority = this.calculateChunkPriority(chunkContent, density);
        
        chunks.push({
          id: `${documentId}-aggressive-${chunkIndex++}`,
          content: chunkContent,
          position: position,
          size: chunkContent.length,
          priority,
          estimatedTokens: estimateGeminiTokens(chunkContent),
          metadata: {
            hasTable: this.detectTables(chunkContent),
            hasNumbers: this.detectNumbers(chunkContent),
            hasLegalTerms: this.detectLegalTerms(chunkContent),
            section: this.identifySection(chunkContent),
            chunkType: this.classifyChunkType(chunkContent)
          }
        });
      }
      
      position = endPosition - config.overlap;
    }
    
    // Optimizar orden de procesamiento
    const optimizedChunks = this.optimizeProcessingOrder(chunks);
    
    return {
      chunks: optimizedChunks,
      strategy: 'aggressive',
      totalChunks: optimizedChunks.length,
      estimatedProcessingTime: Math.ceil(optimizedChunks.length / config.maxParallel) * 6000,
      recommendedModel: 'gemini' // Gemini maneja mejor documentos grandes
    };
  }

  /**
   * Chunking semántico para documentos masivos (60-100MB)
   */
  private async semanticChunking(
    content: string,
    documentId: string,
    metadata?: DocumentMetadata
  ): Promise<ChunkResult> {
    this.logger.error(`🚨 DOCUMENTO MASIVO: ${(content.length / 1024 / 1024).toFixed(2)}MB`);
    this.logger.log('📊 Iniciando análisis semántico profundo...');
    
    // Análisis semántico profundo
    const semanticBoundaries = await this.findSemanticBoundaries(content);
    const chunks = [];
    let chunkIndex = 0;
    
    for (let i = 0; i < semanticBoundaries.length - 1; i++) {
      const start = semanticBoundaries[i];
      const end = semanticBoundaries[i + 1];
      const sectionContent = content.substring(start, end);
      
      // Subdividir secciones muy grandes
      if (sectionContent.length > 1000000) { // >1MB
        const subChunks = this.subdivideSection(sectionContent, 800000);
        
        for (const subChunk of subChunks) {
          chunks.push({
            id: `${documentId}-semantic-${chunkIndex++}`,
            content: subChunk.content,
            position: start + subChunk.offset,
            size: subChunk.content.length,
            priority: this.evaluateSemanticPriority(subChunk.content),
            estimatedTokens: estimateGeminiTokens(subChunk.content),
            metadata: {
              hasTable: this.detectTables(subChunk.content),
              hasNumbers: this.detectNumbers(subChunk.content),
              hasLegalTerms: this.detectLegalTerms(subChunk.content),
              section: this.identifySection(subChunk.content),
              chunkType: this.classifyChunkType(subChunk.content)
            }
          });
        }
      } else if (sectionContent.length > 10000) { // >10KB
        chunks.push({
          id: `${documentId}-semantic-${chunkIndex++}`,
          content: sectionContent,
          position: start,
          size: sectionContent.length,
          priority: this.evaluateSemanticPriority(sectionContent),
          estimatedTokens: estimateGeminiTokens(sectionContent),
          metadata: {
            hasTable: this.detectTables(sectionContent),
            hasNumbers: this.detectNumbers(sectionContent),
            hasLegalTerms: this.detectLegalTerms(sectionContent),
            section: this.identifySection(sectionContent),
            chunkType: this.classifyChunkType(sectionContent)
          }
        });
      }
    }
    
    // Priorizar chunks por importancia semántica
    const prioritizedChunks = this.prioritizeSemanticChunks(chunks);
    
    return {
      chunks: prioritizedChunks,
      strategy: 'semantic',
      totalChunks: prioritizedChunks.length,
      estimatedProcessingTime: prioritizedChunks.length * 8000,
      recommendedModel: 'gemini' // Gemini es imprescindible para documentos masivos
    };
  }

  /**
   * Chunking de emergencia para documentos >100MB
   */
  private async emergencyChunking(
    content: string,
    documentId: string,
    metadata?: DocumentMetadata
  ): Promise<ChunkResult> {
    this.logger.error(`💥 DOCUMENTO EXTREMO: ${(content.length / 1024 / 1024).toFixed(2)}MB - CHUNKING DE EMERGENCIA`);
    
    // Estrategia de emergencia: chunks más pequeños, procesamiento muy conservador
    const EMERGENCY_CHUNK_SIZE = 400000; // 400K chars (~100K tokens)
    const EMERGENCY_OVERLAP = 20000;      // 20K chars overlap
    
    const chunks = [];
    let position = 0;
    let chunkIndex = 0;
    
    while (position < content.length) {
      const endPosition = Math.min(position + EMERGENCY_CHUNK_SIZE, content.length);
      const chunkContent = content.substring(position, endPosition);
      
      if (chunkContent.length > 1000) {
        chunks.push({
          id: `${documentId}-emergency-${chunkIndex++}`,
          content: chunkContent,
          position: position,
          size: chunkContent.length,
          priority: 'low' as const, // Prioridad baja para procesamiento conservador
          estimatedTokens: estimateGeminiTokens(chunkContent),
          metadata: {
            hasTable: this.detectTables(chunkContent),
            hasNumbers: this.detectNumbers(chunkContent),
            hasLegalTerms: this.detectLegalTerms(chunkContent),
            section: `emergency_section_${Math.floor(position / EMERGENCY_CHUNK_SIZE)}`,
            chunkType: 'content' as const
          }
        });
      }
      
      position = endPosition - EMERGENCY_OVERLAP;
    }
    
    this.logger.warn(`⚡ Chunking de emergencia completado: ${chunks.length} chunks`);
    
    return {
      chunks: chunks,
      strategy: 'emergency',
      totalChunks: chunks.length,
      estimatedProcessingTime: chunks.length * 10000, // 10s por chunk para ser conservador
      recommendedModel: 'gemini' // Solo Gemini puede manejar esto
    };
  }

  // ===== MÉTODOS DE ANÁLISIS =====

  /**
   * Identifica secciones críticas para underwriting
   */
  private identifyCriticalSections(content: string): Array<{
    name: string;
    content: string;
    start: number;
    end: number;
  }> {
    const sections = [];
    
    // Patrones críticos para underwriting
    const criticalPatterns = [
      { pattern: /(coverage\s+limit|policy\s+limit|limit\s+of\s+liability)[\s\S]{0,2000}/gi, name: 'Coverage Limits' },
      { pattern: /(premium|rate|cost|fee)[\s\S]{0,1500}/gi, name: 'Premium Information' },
      { pattern: /(deductible|retention|self[\-\s]insured)[\s\S]{0,1500}/gi, name: 'Deductibles' },
      { pattern: /(exclusion|excluded|not\s+covered)[\s\S]{0,2000}/gi, name: 'Exclusions' },
      { pattern: /(claim|loss|incident)[\s\S]{0,2000}/gi, name: 'Claims Information' },
      { pattern: /(risk\s+assessment|underwriting|exposure)[\s\S]{0,2000}/gi, name: 'Risk Assessment' },
    ];
    
    for (const { pattern, name } of criticalPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const start = Math.max(0, match.index - 500);
        const end = Math.min(content.length, match.index + match[0].length + 500);
        
        sections.push({
          name,
          content: content.substring(start, end),
          start,
          end
        });
      }
    }
    
    return sections;
  }

  /**
   * Encuentra límites semánticos en texto grande
   */
  private async findSemanticBoundaries(content: string): Promise<number[]> {
    const boundaries = [0];
    
    // Patrones de límites semánticos
    const boundaryPatterns = [
      /^#{1,6}\s+.+$/gm,               // Markdown headers
      /^[A-Z][A-Z\s]{10,}$/gm,         // UPPERCASE HEADERS
      /^(SECTION|ARTICLE|CHAPTER)\s+\d+/gmi,  // Numbered sections
      /^\d+\.\s+[A-Z]/gm,              // Numbered items
      /^[A-Z]\.\s+[A-Z]/gm,            // Letter items
      /\n\s*\n\s*\n/g,                 // Multiple blank lines
      /^[-=]{5,}$/gm,                  // Separator lines
      /^(SCHEDULE|EXHIBIT|APPENDIX)/gmi, // Document sections
    ];
    
    for (const pattern of boundaryPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        boundaries.push(match.index);
      }
    }
    
    // Filtrar y ordenar boundaries
    const uniqueBoundaries = [...new Set(boundaries)]
      .sort((a, b) => a - b)
      .filter((boundary, index, arr) => {
        // Eliminar boundaries muy cercanos entre sí
        return index === 0 || boundary - arr[index - 1] > 20000;
      });
    
    uniqueBoundaries.push(content.length);
    
    return uniqueBoundaries;
  }

  // ===== MÉTODOS DE DETECCIÓN =====

  private detectTables(content: string): boolean {
    const tablePatterns = [
      /\|.*\|.*\|/,                    // Markdown tables
      /<table[^>]*>/i,                 // HTML tables
      /\t.*\t.*\n/,                    // Tab-separated
      /^\s*\d+\s+.*\s+\$[\d,]+/gm,    // Financial tables
      /^\s*[A-Z][^:]*:\s*[\d,]+/gm,   // Key-value tables
    ];
    
    return tablePatterns.some(pattern => pattern.test(content));
  }

  private detectNumbers(content: string): boolean {
    const numberPatterns = [
      /\$[\d,]+\.?\d*/g,               // Currency
      /\d{1,3}(,\d{3})*\.?\d*/g,      // Numbers with commas
      /\d+%/g,                         // Percentages
      /\d{4}-\d{2}-\d{2}/g,           // Dates
    ];
    
    return numberPatterns.some(pattern => pattern.test(content));
  }

  private detectLegalTerms(content: string): boolean {
    const legalTerms = [
      /\b(shall|must|will|may|liability|obligation|responsible|indemnify)\b/gi,
      /\b(contract|agreement|policy|terms|conditions|clause)\b/gi,
      /\b(plaintiff|defendant|court|judge|legal|law)\b/gi,
    ];
    
    return legalTerms.some(pattern => pattern.test(content));
  }

  // ===== MÉTODOS DE UTILIDAD =====

  private findSemanticBoundary(content: string, start: number, maxEnd: number): number {
    // Buscar el final de una oración o párrafo cerca del límite
    const searchArea = content.substring(Math.max(0, maxEnd - 1000), maxEnd + 500);
    
    const boundaryPatterns = [
      /\.\s*\n/g,                      // End of sentence + newline
      /\n\s*\n/g,                      // Paragraph break
      /\.\s+[A-Z]/g,                   // End of sentence + capital
    ];
    
    for (const pattern of boundaryPatterns) {
      let match;
      while ((match = pattern.exec(searchArea)) !== null) {
        const position = Math.max(0, maxEnd - 1000) + match.index + match[0].length;
        if (position <= maxEnd + 500 && position > start) {
          return position;
        }
      }
    }
    
    return maxEnd;
  }

  private analyzeDensity(content: string): Map<number, string> {
    const densityMap = new Map<number, string>();
    const blockSize = 50000; // 50K chars por bloque
    
    for (let i = 0; i < content.length; i += blockSize) {
      const block = content.substring(i, i + blockSize);
      
      // Calcular densidad basada en contenido no-whitespace y números
      const nonWhitespace = block.replace(/\s/g, '').length;
      const numbers = (block.match(/\d/g) || []).length;
      const density = (nonWhitespace + numbers * 2) / block.length;
      
      let densityLevel: string;
      if (density > 0.9) densityLevel = 'very_high';
      else if (density > 0.7) densityLevel = 'high';
      else if (density > 0.5) densityLevel = 'medium';
      else if (density > 0.3) densityLevel = 'low';
      else densityLevel = 'very_low';
      
      densityMap.set(Math.floor(i / blockSize), densityLevel);
    }
    
    return densityMap;
  }

  private generateContentHash(content: string): string {
    // Hash simple basado en tamaño y primeros/últimos caracteres
    const start = content.substring(0, 1000);
    const end = content.substring(Math.max(0, content.length - 1000));
    return `${content.length}-${start.length}-${end.length}-${Date.now() % 86400000}`;
  }

  private manageCacheSize(): void {
    if (this.chunkCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.chunkCache.keys().next().value;
      this.chunkCache.delete(firstKey);
      this.logger.log(`🗑️ Caché limpiado: removido ${firstKey}`);
    }
  }

  // Métodos auxiliares simplificados para los casos más complejos
  private hasOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
    return start1 < end2 && start2 < end1;
  }

  private identifySection(content: string): string {
    const firstLine = content.split('\n')[0].trim();
    return firstLine.length > 0 && firstLine.length < 100 
      ? firstLine.replace(/[^a-zA-Z0-9\s]/g, '').substring(0, 50)
      : 'general_content';
  }

  private prioritizeChunks(chunks: any[]): any[] {
    const priority = { critical: 0, high: 1, medium: 2, low: 3 };
    return chunks.sort((a, b) => priority[a.priority] - priority[b.priority]);
  }

  // Métodos simplificados para casos complejos - implementación básica
  private getDensityAtPosition(densityMap: Map<number, string>, position: number): string {
    const blockIndex = Math.floor(position / 50000);
    return densityMap.get(blockIndex) || 'medium';
  }

  private adjustChunkSizeForDensity(baseSize: number, density: string): number {
    const multipliers = { very_high: 0.6, high: 0.8, medium: 1.0, low: 1.2, very_low: 1.4 };
    return Math.floor(baseSize * (multipliers[density] || 1.0));
  }

  private calculateChunkPriority(content: string, density: string): 'critical' | 'high' | 'medium' | 'low' {
    const hasNumbers = this.detectNumbers(content);
    const hasLegal = this.detectLegalTerms(content);
    const hasTables = this.detectTables(content);
    
    if (hasNumbers && hasLegal && hasTables) return 'critical';
    if ((hasNumbers && hasLegal) || (hasTables && density === 'high')) return 'high';
    if (hasNumbers || hasLegal || hasTables) return 'medium';
    return 'low';
  }

  private classifyChunkType(content: string): 'header' | 'content' | 'footer' | 'table' | 'summary' {
    if (this.detectTables(content)) return 'table';
    if (content.toLowerCase().includes('summary') || content.toLowerCase().includes('conclusion')) return 'summary';
    return 'content';
  }

  private optimizeProcessingOrder(chunks: any[]): any[] {
    // Agrupar por prioridad y mezclar para mejor distribución
    const critical = chunks.filter(c => c.priority === 'critical');
    const high = chunks.filter(c => c.priority === 'high');
    const medium = chunks.filter(c => c.priority === 'medium');
    const low = chunks.filter(c => c.priority === 'low');
    
    return [...critical, ...high, ...medium, ...low];
  }

  private subdivideSection(content: string, maxSize: number): Array<{ content: string; offset: number }> {
    const subChunks = [];
    let offset = 0;
    
    while (offset < content.length) {
      const endOffset = Math.min(offset + maxSize, content.length);
      subChunks.push({
        content: content.substring(offset, endOffset),
        offset
      });
      offset = endOffset - 5000; // 5K overlap
    }
    
    return subChunks;
  }

  private evaluateSemanticPriority(content: string): 'critical' | 'high' | 'medium' | 'low' {
    // Análisis semántico simplificado
    const criticalKeywords = ['limit', 'coverage', 'premium', 'deductible', 'exclusion'];
    const keywordCount = criticalKeywords.reduce((count, keyword) => {
      return count + (content.toLowerCase().match(new RegExp(keyword, 'g')) || []).length;
    }, 0);
    
    if (keywordCount > 5) return 'critical';
    if (keywordCount > 2) return 'high';
    if (keywordCount > 0) return 'medium';
    return 'low';
  }

  private prioritizeSemanticChunks(chunks: any[]): any[] {
    return this.prioritizeChunks(chunks);
  }
}