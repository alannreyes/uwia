# UWIA - Underwriting Intelligence API

Sistema de procesamiento inteligente de documentos de seguros usando Google Gemini AI para análisis automático de pólizas, cartas de protección, certificados y reportes.

## 🚀 Características Principales

- **Procesamiento 100% Gemini**: Sistema optimizado que usa exclusivamente Google Gemini APIs
- **Enrutamiento Inteligente**: Selección automática entre Inline API y File API según tamaño de archivo
- **Respuestas Consolidadas**: Un solo objeto de respuesta por documento con valores separados por punto y coma
- **Escalabilidad**: Manejo de archivos desde 0.1MB hasta 66MB+ con división automática de páginas
- **Logging Avanzado**: Logs detallados para validación y debug de respuestas

## 🏗️ Arquitectura del Sistema

### Endpoint Principal: `/api/underwriting/evaluate-gemini`

**Método**: `POST` (multipart/form-data)
**Uso**: Procesamiento individual de documentos (compatible con N8N)

#### Flujo de Procesamiento

1. **Recepción**: Un archivo PDF por llamada + contexto JSON
2. **Enrutamiento por Tamaño**:
   - `< 1MB` → Gemini Inline API
   - `1-50MB` → Gemini File API directo
   - `> 50MB` → Gemini File API con división de páginas
3. **Procesamiento**: Aplicación de prompts consolidados con reemplazo de variables
4. **Respuesta**: Formato JSON estandarizado con respuesta consolidada

### Tipos de Documentos Soportados

| Documento | PMC Field | Campos Esperados | Descripción |
|-----------|-----------|------------------|-------------|
| `LOP.pdf` | `lop_responses` | 18 campos | Carta de Protección con validaciones de firma y datos |
| `POLICY.pdf` | `policy_responses` | 7 campos | Póliza de seguro con fechas, coberturas y exclusiones |
| `CERTIFICATE.pdf` | `certificate_responses` | 1 campo | Certificado con fecha de completación |
| `ROOF.pdf` | `roof_responses` | 1 campo | Reporte de techo con área total |
| `WEATHER.pdf` | `weather_responses` | 2 campos | Datos meteorológicos de velocidad del viento |

## 📋 Configuración de Variables

### Variables de Contexto

El sistema reemplaza automáticamente las siguientes variables en los prompts:

```json
{
  "%insured_name%": "Nombre del asegurado",
  "%insurance_company%": "Compañía de seguros",
  "%insured_address%": "Dirección completa",
  "%insured_street%": "Dirección de calle",
  "%insured_city%": "Ciudad",
  "%insured_zip%": "Código postal",
  "%date_of_loss%": "Fecha de pérdida (MM-DD-YY)",
  "%policy_number%": "Número de póliza",
  "%claim_number%": "Número de reclamo",
  "%type_of_job%": "Tipo de trabajo",
  "%cause_of_loss%": "Causa de pérdida"
}
```

### Variables de Entorno

```bash
# Google Gemini API
GOOGLE_GEMINI_API_KEY=your_gemini_api_key

# Servidor
PORT=5045
NODE_ENV=production

# Base de Datos
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=uwia_user
DB_PASSWORD=uwia_pass
DB_DATABASE=uwia_dev

# Límites de Archivo
MAX_FILE_SIZE=67108864  # 64MB (recomendado para PDFs grandes)
```

## 🔧 Uso de la API

### Ejemplo de Llamada

```bash
curl -X POST http://localhost:5045/api/underwriting/evaluate-gemini \
  -F "file=@LOP.pdf" \
  -F 'record_id=175568' \
  -F 'document_name=LOP' \
  -F 'context={"insured_name":"John Doe","date_of_loss":"08-30-23","policy_number":"POL123"}'
```

### Respuesta Esperada

```json
{
  "record_id": "175568",
  "status": "success",
  "results": {
    "LOP.pdf": [
      {
        "pmc_field": "lop_responses",
        "question": "Extract the following 18 data points...",
        "answer": "YES;08-30-23;YES;YES;123 Main St;33607;Tampa;FL Florida;08-30-23;POL123;CLM456;YES;YES;YES;YES;YES;YES;YES",
        "confidence": 0.85,
        "processing_method": "gemini_inline_api"
      }
    ]
  },
  "summary": {
    "total_documents": 1,
    "processed_documents": 1,
    "total_fields": 18,
    "answered_fields": 18
  },
  "processed_at": "2025-09-20T12:00:00.000Z"
}
```

## 📊 Logs de Validación

El sistema genera logs especiales para validación rápida:

```log
🎯 [VALIDATION] LOP.pdf → "YES;08-30-23;YES;YES;123 Main St;33607;Tampa;FL Florida..."
🎯 [VALIDATION] POLICY.pdf → "04-20-23;04-20-24;YES;YES;YES;NOT_FOUND;YES"
🎯 [VALIDATION] CERTIFICATE.pdf → "08-28-25"
```

## 🚨 Manejo de Errores

### Documentos No Configurados

```json
{
  "record_id": "175568",
  "status": "error",
  "results": {},
  "errors": ["No prompt configuration found for document: INVOICES"],
  "processed_at": "2025-09-20T12:00:00.000Z"
}
```

### Archivos Demasiado Grandes

El sistema maneja automáticamente archivos grandes usando división de páginas sin errores para el usuario.

## 🔍 Debug y Troubleshooting

### Logs Importantes

- `📋 [VAR-DEBUG]`: Variables de contexto detectadas
- `✅ [PURE-GEMINI]`: Reemplazos de variables exitosos
- `🟢/🟡/🔴 [GEMINI-DOC]`: Rutas de procesamiento por tamaño
- `🎯 [VALIDATION]`: Respuestas consolidadas finales

### Problemas Comunes

1. **Variables vacías**: Verificar que el contexto JSON contenga todos los valores necesarios
2. **Respuesta "NO" inesperada**: Variable de comparación puede estar vacía (ej: `%insurance_company%`)
3. **Timeout**: Archivos muy grandes pueden requerir más tiempo de procesamiento

## 📁 Estructura del Proyecto

```
src/
├── modules/underwriting/
│   ├── underwriting.controller.ts    # Endpoint evaluate-gemini
│   ├── underwriting.service.ts       # Lógica de procesamiento Gemini
│   └── services/
│       ├── gemini.service.ts         # Gemini Inline API
│       └── gemini-file-api.service.ts # Gemini File API + división
database/
├── CONFIGURATION.md                  # Configuración detallada
└── scripts/                         # Scripts de BD
```

## 🚀 Deployment

### Docker

```bash
# Build
docker build -t uwia:latest .

# Run
docker run -d \
  -p 5045:5045 \
  -e GOOGLE_GEMINI_API_KEY=your_key \
  -e DB_HOST=your_db_host \
  uwia:latest
```

### Health Check

```bash
curl http://localhost:5045/api/health
```

### Swagger Documentation

Disponible en: `http://localhost:5045/api/docs`

---

**Versión**: 2025-09-20 | **Status**: Producción ✅ | **API**: 100% Gemini 🤖