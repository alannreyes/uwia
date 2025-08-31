export const openaiConfig = {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-4o',
  validationModel: process.env.OPENAI_VALIDATION_MODEL || 'gpt-4o', // Modelo premium para validación
  enabled: process.env.OPENAI_ENABLED === 'true',
  dualValidation: process.env.OPENAI_DUAL_VALIDATION === 'true', // Activar validación dual
  timeout: parseInt(process.env.OPENAI_TIMEOUT) || 90000, // Aumentado para LOP processing
  maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES) || 3,
  retryDelay: parseInt(process.env.OPENAI_RETRY_DELAY) || 2000,
  temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.3,
  maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 1000,
  maxTextLength: parseInt(process.env.OPENAI_MAX_TEXT_LENGTH) || 500000,
  useForSimplePdfsOnly: process.env.OPENAI_USE_FOR_SIMPLE_PDFS_ONLY === 'true',
  fallbackToLocal: process.env.OPENAI_FALLBACK_TO_LOCAL === 'true',
  rateLimits: {
    rpm: parseInt(process.env.OPENAI_RATE_LIMIT_RPM) || 30,
    tpm: parseInt(process.env.OPENAI_RATE_LIMIT_TPM) || 30000,
  },
};

export const processingConfig = {
  localProcessingDefault: process.env.LOCAL_PROCESSING_DEFAULT === 'true',
  localProcessingForComplexPdfs: process.env.LOCAL_PROCESSING_FOR_COMPLEX_PDFS === 'true',
};

export const throttleConfig = {
  ttl: parseInt(process.env.THROTTLE_TTL) || 60,
  limit: parseInt(process.env.THROTTLE_LIMIT) || 30,
};