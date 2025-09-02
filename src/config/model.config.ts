/**
 * Configuración centralizada de modelos de IA
 * Mantiene compatibilidad total con openai.config.ts
 */

// Importar configuración existente para mantener compatibilidad
import { openaiConfig } from './openai.config';
// NUEVO: Importar configuración de Gemini (sin afectar sistema actual)
import { geminiConfig, isGeminiAvailable } from './gemini.config';

/**
 * Configuración de Claude (Anthropic)
 * Claude Sonnet 4 con 200K tokens de contexto
 */
export const claudeConfig = {
  // Credenciales y endpoint
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  
  // Estado del servicio
  enabled: !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE',
  
  // Parámetros de generación
  temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE) || 0.3,
  maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS) || 4000,
  
  // Límites específicos de Claude
  maxContextTokens: 200000, // 200K tokens de contexto
  maxDocumentLength: parseInt(process.env.CLAUDE_MAX_DOCUMENT_LENGTH) || 400000, // 400K chars (~160K tokens)
  smartChunking: process.env.CLAUDE_SMART_CHUNKING === 'true', // Chunking inteligente
  
  // Rate limits Claude Sonnet 4 (Ajustados para documentos grandes)
  rateLimits: {
    rpm: parseInt(process.env.CLAUDE_RATE_LIMIT_RPM) || 50, // 50 RPM - más permisivo
    itpm: parseInt(process.env.CLAUDE_RATE_LIMIT_ITPM) || 40000, // 40K input tokens/min - incrementado
    otpm: parseInt(process.env.CLAUDE_RATE_LIMIT_OTPM) || 8000, // 8K output tokens/min - incrementado
    maxRetries: parseInt(process.env.CLAUDE_MAX_RETRIES) || 3, // Menos reintentos para fallar rápido
    baseDelay: parseInt(process.env.CLAUDE_RETRY_BASE_DELAY) || 10000, // 10s base delay - reducido
    maxDelay: parseInt(process.env.CLAUDE_RETRY_MAX_DELAY) || 60000, // 1 minuto máximo - reducido
  },
  
  // Timeouts y reintentos - optimizados para documentos grandes
  timeout: parseInt(process.env.ANTHROPIC_TIMEOUT) || 180000, // 3 minutos para documentos muy grandes
  maxRetries: parseInt(process.env.ANTHROPIC_MAX_RETRIES) || 2, // Menos reintentos para fallar rápido
  retryDelay: parseInt(process.env.ANTHROPIC_RETRY_DELAY) || 3000, // 3 segundos entre reintentos - reducido
  
  // Características especiales - ajustadas para grandes documentos
  useFullDocument: process.env.CLAUDE_FORCE_CHUNKING !== 'true', // Permitir desactivar para docs problemáticos
  specialization: 'long-context-analysis', // Especializado en análisis de contexto largo
  anthropicVersion: '06-01-23', // Versión de la API de Anthropic
  
  // Límites adicionales para estabilidad
  maxDocumentTokens: parseInt(process.env.CLAUDE_MAX_DOC_TOKENS) || 180000, // Límite conservador de tokens por doc
  circuitBreakerThreshold: parseInt(process.env.CLAUDE_CB_THRESHOLD) || 5, // Abrir circuit breaker tras 5 fallos
  
  // Performance y monitoring
  performanceLogging: process.env.CLAUDE_PERFORMANCE_LOGGING === 'true',
  successRateThreshold: parseFloat(process.env.CLAUDE_SUCCESS_RATE_THRESHOLD) || 85,
  autoFallback: process.env.CLAUDE_AUTO_FALLBACK !== 'false', // Default true
};

/**
 * Configuración de Qwen-Long (DEPRECATED - requiere Beijing key)
 * Mantenido por compatibilidad pero desactivado
 */
export const qwenConfig = {
  apiKey: process.env.QWEN_API_KEY,
  baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: process.env.QWEN_MODEL || 'qwen-long-latest',
  enabled: false, // Desactivado - requiere Beijing API key
  temperature: parseFloat(process.env.QWEN_TEMPERATURE) || 0.3,
  maxTokens: parseInt(process.env.QWEN_MAX_TOKENS) || 4000,
  maxContextTokens: 10000000,
  maxDocumentLength: 15000000,
  timeout: parseInt(process.env.QWEN_TIMEOUT) || 60000,
  maxRetries: parseInt(process.env.QWEN_MAX_RETRIES) || 3,
  retryDelay: parseInt(process.env.QWEN_RETRY_DELAY) || 3000,
  useFullDocument: true,
  specialization: 'long-context-analysis',
};

/**
 * Configuración del sistema de triple validación
 */
export const tripleValidationConfig = {
  // Activación del sistema - ahora con Claude en lugar de Qwen
  enabled: process.env.TRIPLE_VALIDATION === 'true' && claudeConfig.enabled,
  
  // Umbrales de consenso
  highAgreementThreshold: parseFloat(process.env.TRIPLE_HIGH_AGREEMENT) || 0.8,
  lowAgreementThreshold: parseFloat(process.env.TRIPLE_LOW_AGREEMENT) || 0.5,
  
  // Modelos a usar en cada etapa
  models: {
    primary: openaiConfig.model, // GPT-4o-mini o GPT-4o según config
    independent: claudeConfig.model, // Claude Sonnet 4 para segunda opinión
    arbitrator: process.env.TRIPLE_ARBITRATOR_MODEL || 'gpt-4o', // GPT-4o como árbitro
  },
  
  // Estrategia de fallback
  fallbackStrategy: process.env.TRIPLE_FALLBACK_STRATEGY || 'dual', // 'dual' | 'simple'
  allowPartialValidation: process.env.TRIPLE_ALLOW_PARTIAL !== 'false', // Default true
  
  // Logging y metadata
  verboseLogging: process.env.TRIPLE_VERBOSE_LOGGING === 'true',
  includeReasoningInResponse: process.env.TRIPLE_INCLUDE_REASONING === 'true',
};

/**
 * Configuración unificada de modelos
 * Centraliza toda la configuración manteniendo compatibilidad
 */
export const modelConfig = {
  // OpenAI (mantiene compatibilidad total)
  openai: openaiConfig,
  
  // Claude (Anthropic) - Claude Sonnet 4 - reemplaza a Qwen
  claude: claudeConfig,
  
  // Qwen-Long (DEPRECATED - mantenido por compatibilidad)
  qwen: qwenConfig,
  
  // NUEVO: Gemini 2.5 Pro - Inicialmente deshabilitado
  gemini: geminiConfig,
  
  // Sistema de validación
  validation: {
    // Validación dual existente
    dual: {
      enabled: openaiConfig.dualValidation,
      primaryModel: openaiConfig.model,
      validationModel: openaiConfig.validationModel,
    },
    
    // Nueva validación triple con Claude Sonnet 4
    triple: tripleValidationConfig,
  },
  
  // Selector de estrategia
  getValidationStrategy(): 'triple' | 'dual' | 'simple' {
    if (tripleValidationConfig.enabled) {
      return 'triple';
    } else if (openaiConfig.dualValidation) {
      return 'dual';
    } else {
      return 'simple';
    }
  },
  
  // Helper para verificar disponibilidad de modelo independiente
  isIndependentModelAvailable(): boolean {
    return claudeConfig.enabled && !!claudeConfig.apiKey;
  },
  
  // Helper para verificar disponibilidad de Qwen (deprecated)
  isQwenAvailable(): boolean {
    return false; // Siempre false ahora
  },
  
  // Helper para verificar disponibilidad de Claude
  isClaudeAvailable(): boolean {
    return claudeConfig.enabled && !!claudeConfig.apiKey;
  },
  
  // NUEVO: Helper para verificar disponibilidad de Gemini
  isGeminiAvailable(): boolean {
    return isGeminiAvailable();
  },
  
  // Helper para obtener configuración de modelo por nombre
  getModelConfig(modelName: string) {
    switch (modelName) {
      case 'qwen-long-latest':
      case 'qwen':
        return qwenConfig;
      default:
        return openaiConfig;
    }
  },
  
  // NUEVO: Sistema de migración gradual - NO AFECTA SISTEMA ACTUAL
  migration: {
    // Feature flags para control granular
    gpt5Enabled: process.env.OPENAI_GPT5_ENABLED === 'true',
    geminiEnabled: geminiConfig.enabled,
    
    // Modo de migración: 'off' | 'testing' | 'canary' | 'full'
    mode: process.env.MIGRATION_MODE || 'off',
    canaryPercentage: parseInt(process.env.CANARY_PERCENTAGE) || 0,
    
    // Configuración de modelos nuevos
    newModels: {
      primary: process.env.MIGRATION_PRIMARY_MODEL || 'gpt-5',
      independent: process.env.MIGRATION_INDEPENDENT_MODEL || 'gemini-2.5-pro',
      arbitrator: process.env.MIGRATION_ARBITRATOR_MODEL || 'gpt-5',
    },
    
    // Fallback estrategia
    allowFallbackToOldSystem: process.env.MIGRATION_ALLOW_FALLBACK !== 'false',
    
    // Función para determinar si usar nuevo sistema
    shouldUseNewSystem(): boolean {
      if (!this.gpt5Enabled && !this.geminiEnabled) return false;
      
      switch (this.mode) {
        case 'off':
          return false;
        case 'testing':
          return process.env.NODE_ENV === 'development';
        case 'canary':
          return Math.random() * 100 < this.canaryPercentage;
        case 'full':
          return true;
        default:
          return false;
      }
    }
  }
};

// Exportar configuración por defecto
export default modelConfig;