/**
 * Configuración especializada para procesamiento de PDFs grandes
 * Optimizado para documentos legales de 50MB+ sin romper funcionalidad existente
 */

/**
 * Configuración de thresholds y límites
 */
export const largePdfThresholds = {
  // Tamaños de archivo - REDUCED from 50MB to 30MB for better large file detection
  standardSizeLimit: parseInt(process.env.LARGE_PDF_THRESHOLD_MB) || 30, // MB
  ultraLargeSizeLimit: parseInt(process.env.ULTRA_LARGE_PDF_THRESHOLD_MB) || 80, // MB
  
  // Límites de texto extraído para detectar fallo de OCR
  minTextCharsForSuccess: parseInt(process.env.MIN_TEXT_CHARS_SUCCESS) || 1000,
  minTextCharsPerMB: parseInt(process.env.MIN_TEXT_CHARS_PER_MB) || 200,
  
  // Límites de páginas por campo
  maxPagesPerField: parseInt(process.env.LARGE_PDF_MAX_PAGES_PER_FIELD) || 5,
  maxPagesForComprehensive: parseInt(process.env.LARGE_PDF_MAX_PAGES_COMPREHENSIVE) || 8,
  
  // Sampling para análisis inicial
  maxSamplePages: parseInt(process.env.LARGE_PDF_MAX_SAMPLE_PAGES) || 10,
};

/**
 * Configuración de timeouts escalados por tamaño
 */
export const largePdfTimeouts = {
  /**
   * Calcula timeout dinámico basado en tamaño del archivo
   */
  getTimeoutForSize(fileSizeMB: number): number {
    const baseTimeout = parseInt(process.env.ANTHROPIC_TIMEOUT) || 60000;
    const multiplier = parseFloat(process.env.LARGE_PDF_TIMEOUT_MULTIPLIER) || 3;
    
    if (fileSizeMB >= largePdfThresholds.ultraLargeSizeLimit) {
      return parseInt(process.env.ULTRA_LARGE_PDF_TIMEOUT) || 300000; // 5 minutos para ultra-grandes
    }
    
    if (fileSizeMB >= largePdfThresholds.standardSizeLimit) {
      return Math.min(baseTimeout * multiplier, 180000); // Máximo 3 minutos
    }
    
    return baseTimeout; // Timeout normal para archivos pequeños
  },

  /**
   * Timeout por página para procesamiento visual
   */
  getTimeoutPerPage(totalPages: number): number {
    const basePerPage = 15000; // 15 segundos por página base
    
    if (totalPages > 50) {
      return 10000; // 10 segundos por página para documentos muy grandes
    }
    
    if (totalPages > 20) {
      return 12000; // 12 segundos por página para documentos grandes
    }
    
    return basePerPage;
  },

  /**
   * Timeout para quick scan de clasificación de páginas
   */
  quickScanTimeout: parseInt(process.env.LARGE_PDF_QUICK_SCAN_TIMEOUT) || 45000,
};

/**
 * Configuración de chunking para OCR progresivo
 */
export const largePdfChunking = {
  /**
   * Tamaño de chunk basado en tamaño total del archivo
   */
  getChunkSizeForFile(fileSizeMB: number): number {
    const configuredChunkSize = parseInt(process.env.LARGE_PDF_CHUNK_SIZE_MB) || 3;
    
    if (fileSizeMB >= largePdfThresholds.ultraLargeSizeLimit) {
      return configuredChunkSize * 1024 * 1024; // 3MB chunks para ultra-grandes
    }
    
    if (fileSizeMB >= largePdfThresholds.standardSizeLimit) {
      return (configuredChunkSize * 1.5) * 1024 * 1024; // 4.5MB chunks para grandes
    }
    
    return fileSizeMB * 1024 * 1024; // Archivo completo para pequeños
  },

  /**
   * Número máximo de chunks a procesar en paralelo
   */
  maxParallelChunks: parseInt(process.env.LARGE_PDF_MAX_PARALLEL_CHUNKS) || 3,

  /**
   * Delay entre procesamiento de chunks para evitar rate limiting
   */
  chunkProcessingDelay: parseInt(process.env.LARGE_PDF_CHUNK_DELAY_MS) || 1000,
};

/**
 * Configuración de estrategias de procesamiento
 */
export const largePdfStrategies = {
  /**
   * Determina la estrategia de procesamiento basada en características del archivo
   */
  determineStrategy(
    fileSizeMB: number, 
    extractedTextLength: number, 
    pageCount: number
  ): 'enhanced-ocr' | 'vision-chunked' | 'hybrid' | 'standard' {
    
    // Archivos pequeños: usar estrategia estándar existente
    if (fileSizeMB < largePdfThresholds.standardSizeLimit) {
      return 'standard';
    }

    // Calcular ratio de texto por MB
    const textPerMB = extractedTextLength / fileSizeMB;
    const minExpectedTextPerMB = largePdfThresholds.minTextCharsPerMB;

    // Si OCR falló completamente: usar vision-chunked
    if (extractedTextLength < largePdfThresholds.minTextCharsForSuccess) {
      return 'vision-chunked';
    }

    // Si OCR extrajo poco texto relativo al tamaño: híbrido
    if (textPerMB < minExpectedTextPerMB) {
      return 'hybrid';
    }

    // OCR funcionó bien: enhanced-ocr con optimizaciones
    return 'enhanced-ocr';
  },

  /**
   * Configuración específica por estrategia
   */
  strategyConfig: {
    'enhanced-ocr': {
      useProgressiveExtraction: true,
      enableTextOptimization: true,
      maxConcurrentFields: 6,
      delayBetweenFields: 100,
    },
    
    'vision-chunked': {
      enableSmartPageTargeting: true,
      maxPagesPerField: largePdfThresholds.maxPagesPerField,
      useGeminiVisionPrimary: true,
      enableEarlyExit: true,
    },
    
    'hybrid': {
      useTextForSimpleFields: true,
      useVisionForComplexFields: true,
      textFieldThreshold: 0.7, // Confianza mínima para usar texto
      maxPagesPerField: 3,
    },
    
    'standard': {
      // Configuración actual sin cambios
      useCurrentLogic: true,
    }
  }
};

/**
 * Configuración de optimización de rendimiento
 */
export const largePdfPerformance = {
  // Memory management
  enableMemoryOptimization: process.env.LARGE_PDF_ENABLE_MEMORY_OPT === 'true',
  maxMemoryUsageMB: parseInt(process.env.LARGE_PDF_MAX_MEMORY_MB) || 512,
  
  // Concurrency limits
  maxConcurrentVisionCalls: parseInt(process.env.LARGE_PDF_MAX_VISION_CONCURRENT) || 3,
  maxConcurrentTextCalls: parseInt(process.env.LARGE_PDF_MAX_TEXT_CONCURRENT) || 5,
  
  // Caching
  enablePageAnalysisCache: process.env.LARGE_PDF_ENABLE_CACHE !== 'false',
  cacheExpirationMinutes: parseInt(process.env.LARGE_PDF_CACHE_EXPIRY_MIN) || 30,
  
  // Progress tracking
  enableProgressLogging: process.env.LARGE_PDF_ENABLE_PROGRESS_LOG !== 'false',
  progressLogIntervalSeconds: parseInt(process.env.LARGE_PDF_PROGRESS_INTERVAL_SEC) || 10,
};

/**
 * Configuración de fallback y recuperación de errores
 */
export const largePdfFallback = {
  // Reintentos
  maxRetries: parseInt(process.env.LARGE_PDF_MAX_RETRIES) || 2,
  retryDelayMs: parseInt(process.env.LARGE_PDF_RETRY_DELAY_MS) || 3000,
  
  // Fallback strategies
  enableGracefulDegradation: process.env.LARGE_PDF_ENABLE_GRACEFUL_FALLBACK !== 'false',
  fallbackToHeuristics: process.env.LARGE_PDF_FALLBACK_HEURISTICS !== 'false',
  
  // Partial processing
  allowPartialResults: process.env.LARGE_PDF_ALLOW_PARTIAL !== 'false',
  minSuccessfulFieldsPercent: parseInt(process.env.LARGE_PDF_MIN_SUCCESS_PERCENT) || 60,
};

/**
 * Configuración unificada de large PDF
 */
export const largePdfConfig = {
  thresholds: largePdfThresholds,
  timeouts: largePdfTimeouts,
  chunking: largePdfChunking,
  strategies: largePdfStrategies,
  performance: largePdfPerformance,
  fallback: largePdfFallback,
  
  /**
   * Helper para verificar si un archivo requiere procesamiento especial
   */
  requiresLargePdfProcessing(fileSizeMB: number): boolean {
    return fileSizeMB >= largePdfThresholds.standardSizeLimit;
  },

  /**
   * Helper para verificar si OCR falló y necesita vision fallback
   */
  needsVisionFallback(fileSizeMB: number, extractedTextLength: number): boolean {
    if (!this.requiresLargePdfProcessing(fileSizeMB)) {
      return false;
    }
    
    const textPerMB = extractedTextLength / fileSizeMB;
    return textPerMB < largePdfThresholds.minTextCharsPerMB;
  },

  /**
   * Helper para obtener configuración optimizada por archivo
   */
  getOptimizedConfigForFile(fileSizeMB: number, extractedTextLength: number, pageCount: number) {
    const strategy = largePdfStrategies.determineStrategy(fileSizeMB, extractedTextLength, pageCount);
    
    return {
      strategy,
      timeout: largePdfTimeouts.getTimeoutForSize(fileSizeMB),
      chunkSize: largePdfChunking.getChunkSizeForFile(fileSizeMB),
      maxPagesPerField: strategy === 'vision-chunked' 
        ? largePdfThresholds.maxPagesPerField 
        : largePdfThresholds.maxPagesForComprehensive,
      config: largePdfStrategies.strategyConfig[strategy],
    };
  }
};

// Exportar configuración por defecto
export default largePdfConfig;