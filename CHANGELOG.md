# CHANGELOG

## [2.0.0] - 2025-09-20

### 🚀 MAJOR: Migración Completa a Google Gemini

#### Added
- **Nuevo endpoint `/api/underwriting/evaluate-gemini`** para procesamiento 100% Gemini
- **Enrutamiento inteligente** basado en tamaño de archivo:
  - `< 1MB` → Gemini Inline API
  - `1-50MB` → Gemini File API
  - `> 50MB` → Gemini File API con división automática de páginas
- **Sistema de respuestas consolidadas** - un objeto por documento con valores separados por punto y coma
- **Reemplazo automático de variables** en prompts usando contexto JSON
- **Logs de validación** (`🎯 [VALIDATION]`) para revisión rápida de respuestas
- **Manejo de archivos grandes** hasta 66MB+ con división por páginas
- **Limpieza automática de formato** (remover "mph", convertir números a strings)

#### Changed
- **Arquitectura principal**: Eliminado procesamiento local, OCR y pdf-parse
- **Modelo AI**: Migrado de OpenAI GPT-4 a Google Gemini 1.5 Pro
- **Formato de respuesta**: Consolidado con campos semicolon-separated
- **Configuración**: Variables de entorno actualizadas para Gemini
- **Base de datos**: Uso exclusivo de tabla `document_consolidado`

#### Removed
- ~~Endpoint `/api/underwriting/evaluate-claim`~~ (legacy)
- ~~Procesamiento local con pdf-parse~~
- ~~Servicios OCR y vision~~
- ~~Dependencias OpenAI~~
- ~~Fallbacks a procesamiento local~~

#### Fixed
- **Overflow de tokens**: Umbral ultra-conservador de 1MB para Inline API
- **Corrupción de PDFs**: División por páginas en lugar de bytes
- **Variables vacías**: Debug logs y validación mejorada
- **Formato inconsistente**: Respuestas siempre como strings limpios
- **Consolidación de chunks**: Lógica mejorada para campos YES/NO en documentos grandes
- **Manejo de límites de archivo**: Graceful degradation para archivos que exceden MAX_FILE_SIZE

### 📋 Documentos Soportados

| Documento | Campos | Estado |
|-----------|--------|--------|
| LOP.pdf | 18 | ✅ Funcionando |
| POLICY.pdf | 7 | ✅ Funcionando |
| CERTIFICATE.pdf | 1 | ✅ Funcionando |
| ROOF.pdf | 1 | ✅ Funcionando |
| WEATHER.pdf | 2 | ✅ Funcionando |
| INVOICES.pdf | - | ⚠️ No configurado |

### 🔧 Technical Details

#### Performance Improvements
- **Velocidad**: Promedio 15-30s por documento (vs 45-60s anterior)
- **Escalabilidad**: Manejo de archivos 3x más grandes
- **Precisión**: Respuestas más consistentes con Gemini

#### API Changes
```bash
# Antes (legacy)
POST /api/underwriting/evaluate-claim

# Ahora (current)
POST /api/underwriting/evaluate-gemini
```

#### Response Format Evolution
```json
// Antes: Múltiples objetos separados
[{}, {}, {}]

// Ahora: Un objeto por documento con respuesta consolidada
{
  "results": {
    "LOP.pdf": [{ "answer": "YES;08-30-23;YES;YES;..." }]
  }
}
```

### 🐛 Known Issues

1. **Variable `insurance_company` vacía**: Causa respuesta "NO" en `matching_insured_company`
   - **Workaround**: Verificar contexto JSON en N8N
   - **Status**: En investigación

2. **INVOICES.pdf no configurado**: Error esperado hasta configuración manual
   - **Status**: Por diseño

### 🔄 Migration Guide

#### Para N8N
1. Cambiar endpoint de `evaluate-claim` a `evaluate-gemini`
2. Verificar que todas las variables de contexto tengan valores
3. Actualizar timeouts a 60+ segundos para archivos grandes

#### Para Desarrolladores
1. Actualizar variables de entorno:
   ```bash
   # Reemplazar
   OPENAI_API_KEY=xxx

   # Por
   GOOGLE_GEMINI_API_KEY=xxx
   ```

2. Actualizar límites de archivo:
   ```bash
   MAX_FILE_SIZE=67108864  # 64MB
   ```

---

## [1.x.x] - Pre-Gemini (Legacy)

Versiones anteriores utilizando OpenAI GPT-4, pdf-parse, y procesamiento local.
Documentación archivada disponible en commits previos a Sept 2025.