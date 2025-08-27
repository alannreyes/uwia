/**
 * Configuración centralizada de modelos de IA
 * Mantiene compatibilidad total con openai.config.ts
 */

// Importar configuración existente para mantener compatibilidad
import { openaiConfig } from './openai.config';

/**
 * Configuración de Qwen-Long
 * Modelo especializado en documentos largos con contexto de 10M tokens
 */
export const qwenConfig = {
  // Credenciales y endpoint
  apiKey: process.env.QWEN_API_KEY,
  baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: process.env.QWEN_MODEL || 'qwen-long-latest',
  
  // Estado del servicio
  enabled: !!process.env.QWEN_API_KEY && process.env.QWEN_API_KEY !== 'YOUR_QWEN_API_KEY_HERE',
  
  // Parámetros de generación
  temperature: parseFloat(process.env.QWEN_TEMPERATURE) || 0.3,
  maxTokens: parseInt(process.env.QWEN_MAX_TOKENS) || 4000,
  
  // Límites específicos de Qwen
  maxContextTokens: 10000000, // 10M tokens de contexto
  maxDocumentLength: 15000000, // ~15M caracteres
  
  // Timeouts y reintentos
  timeout: parseInt(process.env.QWEN_TIMEOUT) || 60000, // Mayor timeout por documentos largos
  maxRetries: parseInt(process.env.QWEN_MAX_RETRIES) || 3,
  retryDelay: parseInt(process.env.QWEN_RETRY_DELAY) || 3000,
  
  // Características especiales
  useFullDocument: true, // Qwen puede procesar documento completo sin chunking
  specialization: 'long-context-analysis', // Especializado en análisis de contexto largo
};

/**
 * Configuración del sistema de triple validación
 */
export const tripleValidationConfig = {
  // Activación del sistema
  enabled: process.env.TRIPLE_VALIDATION === 'true' && qwenConfig.enabled,
  
  // Umbrales de consenso
  highAgreementThreshold: parseFloat(process.env.TRIPLE_HIGH_AGREEMENT) || 0.8,
  lowAgreementThreshold: parseFloat(process.env.TRIPLE_LOW_AGREEMENT) || 0.5,
  
  // Modelos a usar en cada etapa
  models: {
    primary: openaiConfig.model, // GPT-4o-mini o GPT-4o según config
    independent: qwenConfig.model, // Qwen-Long para segunda opinión
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
  
  // Qwen-Long (nueva funcionalidad)
  qwen: qwenConfig,
  
  // Sistema de validación
  validation: {
    // Validación dual existente
    dual: {
      enabled: openaiConfig.dualValidation,
      primaryModel: openaiConfig.model,
      validationModel: openaiConfig.validationModel,
    },
    
    // Nueva validación triple
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
  
  // Helper para verificar disponibilidad
  isQwenAvailable(): boolean {
    return qwenConfig.enabled && !!qwenConfig.apiKey;
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