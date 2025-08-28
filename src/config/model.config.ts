/**
 * Configuración centralizada de modelos de IA
 * Mantiene compatibilidad total con openai.config.ts
 */

// Importar configuración existente para mantener compatibilidad
import { openaiConfig } from './openai.config';

/**
 * Configuración de Claude (Anthropic)
 * Claude 3.5 Sonnet con 200K tokens de contexto
 */
export const claudeConfig = {
  // Credenciales y endpoint
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
  
  // Estado del servicio
  enabled: !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'YOUR_ANTHROPIC_API_KEY_HERE',
  
  // Parámetros de generación
  temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE) || 0.3,
  maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS) || 4000,
  
  // Límites específicos de Claude
  maxContextTokens: 200000, // 200K tokens de contexto
  maxDocumentLength: 600000, // ~600K caracteres
  
  // Timeouts y reintentos
  timeout: parseInt(process.env.ANTHROPIC_TIMEOUT) || 60000,
  maxRetries: parseInt(process.env.ANTHROPIC_MAX_RETRIES) || 3,
  retryDelay: parseInt(process.env.ANTHROPIC_RETRY_DELAY) || 3000,
  
  // Características especiales
  useFullDocument: true, // Claude puede procesar documento completo sin chunking extremo
  specialization: 'long-context-analysis', // Especializado en análisis de contexto largo
  anthropicVersion: '2023-06-01', // Versión de la API de Anthropic
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
    independent: claudeConfig.model, // Claude 3.5 Sonnet para segunda opinión
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
  
  // Claude (Anthropic) - reemplaza a Qwen
  claude: claudeConfig,
  
  // Qwen-Long (DEPRECATED - mantenido por compatibilidad)
  qwen: qwenConfig,
  
  // Sistema de validación
  validation: {
    // Validación dual existente
    dual: {
      enabled: openaiConfig.dualValidation,
      primaryModel: openaiConfig.model,
      validationModel: openaiConfig.validationModel,
    },
    
    // Nueva validación triple con Claude
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
};

// Exportar configuración por defecto
export default modelConfig;