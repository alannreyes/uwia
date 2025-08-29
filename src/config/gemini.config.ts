/**
 * Configuración de Gemini 2.5 Pro
 * NUEVO - No afecta sistema existente
 */
export const geminiConfig = {
  // Credenciales y endpoint
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com',
  
  // Modelo y capacidades
  model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
  maxContextTokens: 2000000, // 2M tokens - masivo contexto
  maxDocumentLength: parseInt(process.env.GEMINI_MAX_DOCUMENT_LENGTH) || 5000000, // 5M chars
  
  // Estado del servicio - INICIALMENTE DESHABILITADO
  enabled: process.env.GEMINI_ENABLED === 'true' && !!process.env.GEMINI_API_KEY,
  
  // Parámetros de generación
  temperature: parseFloat(process.env.GEMINI_TEMPERATURE) || 0.3,
  maxOutputTokens: parseInt(process.env.GEMINI_MAX_TOKENS) || 8192,
  
  // Características especiales de Gemini 2.5 Pro
  useThinkingMode: process.env.GEMINI_THINKING_MODE !== 'false', // Default true
  nativeAudioSupport: false, // Por ahora solo texto
  multimodalCapabilities: true,
  
  // Rate limits Gemini 2.5 Pro - conservadores inicialmente
  rateLimits: {
    rpm: parseInt(process.env.GEMINI_RATE_LIMIT_RPM) || 60, // Empezar conservador
    tpm: parseInt(process.env.GEMINI_RATE_LIMIT_TPM) || 1000000, // 1M tokens/min inicialmente
    maxRetries: parseInt(process.env.GEMINI_MAX_RETRIES) || 3,
    baseDelay: parseInt(process.env.GEMINI_RETRY_BASE_DELAY) || 5000,
    maxDelay: parseInt(process.env.GEMINI_RETRY_MAX_DELAY) || 30000,
  },
  
  // Timeouts - optimizados para documentos grandes
  timeout: parseInt(process.env.GEMINI_TIMEOUT) || 120000, // 2 minutos
  maxRetries: parseInt(process.env.GEMINI_MAX_RETRIES_TOTAL) || 2,
  retryDelay: parseInt(process.env.GEMINI_RETRY_DELAY) || 3000,
  
  // Características de procesamiento
  useFullDocument: true, // Aprovechar el contexto masivo de 2M tokens
  specialization: 'massive-context-analysis', // Especializado en contexto masivo
  geminiVersion: '2.5-pro', // Versión del modelo
  
  // Límites adicionales para estabilidad
  maxDocumentTokens: parseInt(process.env.GEMINI_MAX_DOC_TOKENS) || 1800000, // Conservador para 2M
  circuitBreakerThreshold: parseInt(process.env.GEMINI_CB_THRESHOLD) || 5,
  
  // Performance y monitoring
  performanceLogging: process.env.GEMINI_PERFORMANCE_LOGGING === 'true',
  successRateThreshold: parseFloat(process.env.GEMINI_SUCCESS_RATE_THRESHOLD) || 90,
  autoFallback: process.env.GEMINI_AUTO_FALLBACK !== 'false', // Default true
  
  // Configuración de chunking (para casos extremos >2M tokens)
  emergencyChunking: {
    enabled: process.env.GEMINI_EMERGENCY_CHUNKING === 'true',
    maxChunkSize: 1500000, // 1.5M tokens por chunk
    overlapSize: 50000,     // 50K tokens de overlap
  }
};

// Helper para verificar disponibilidad
export function isGeminiAvailable(): boolean {
  return geminiConfig.enabled && !!geminiConfig.apiKey && geminiConfig.apiKey !== 'your_gemini_api_key_here';
}

// Helper para estimar tokens
export function estimateGeminiTokens(text: string): number {
  // Gemini usa aproximadamente 1 token por ~4 caracteres
  return Math.ceil(text.length / 4);
}

// Helper para verificar si el documento es demasiado grande incluso para Gemini
export function isDocumentTooLarge(text: string): boolean {
  const tokens = estimateGeminiTokens(text);
  return tokens > geminiConfig.maxDocumentTokens;
}