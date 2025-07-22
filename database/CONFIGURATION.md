# Configuración del Sistema UWIA

## Variables de Entorno

### OpenAI
- **OPENAI_MODEL**: Modelo a usar (gpt-4o recomendado)
- **OPENAI_ENABLED**: Habilitar/deshabilitar OpenAI
- **OPENAI_MAX_TEXT_LENGTH**: Límite de caracteres para procesar (30000)
- **OPENAI_USE_FOR_SIMPLE_PDFS_ONLY**: Usar solo para PDFs simples
- **OPENAI_FALLBACK_TO_LOCAL**: Cambiar a procesamiento local si falla

### Rate Limiting
- **THROTTLE_TTL**: Tiempo en segundos para el límite (60)
- **THROTTLE_LIMIT**: Número máximo de solicitudes por TTL (30)
- **OPENAI_RATE_LIMIT_RPM**: Solicitudes por minuto a OpenAI (30)
- **OPENAI_RATE_LIMIT_TPM**: Tokens por minuto a OpenAI (30000)
- **OPENAI_MAX_RETRIES**: Reintentos en caso de error (3)
- **OPENAI_RETRY_DELAY**: Demora entre reintentos en ms (2000)

### Procesamiento de Archivos
- **MAX_FILE_SIZE**: Tamaño máximo de archivo en bytes (52428800 = 50MB)
- **LOCAL_PROCESSING_DEFAULT**: Usar procesamiento local por defecto (false)
- **LOCAL_PROCESSING_FOR_COMPLEX_PDFS**: Procesar PDFs complejos localmente (true)

## Características de Seguridad

1. **Rate Limiting**: Protege contra abuso limitando solicitudes
2. **Validación de Tamaño**: Rechaza archivos muy grandes
3. **Procesamiento Selectivo**: PDFs complejos se procesan localmente
4. **Fallback Automático**: Si OpenAI falla, cambia a procesamiento local
5. **Límites de Texto**: Evita procesar documentos excesivamente largos

## Optimizaciones de Rendimiento

1. **Cache de Consultas**: Las consultas a BD se cachean automáticamente
2. **Procesamiento Paralelo**: Múltiples documentos se procesan en paralelo
3. **Reintentos Inteligentes**: Reintentos con backoff exponencial
4. **Límites de Token**: Control del uso de tokens de OpenAI