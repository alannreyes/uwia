# UWIA API Reference

## Endpoint Principal

### `POST /api/underwriting/evaluate-gemini`

Procesa un documento PDF individual usando Google Gemini AI y retorna respuestas consolidadas.

#### Parámetros de Entrada

**Método**: `POST`
**Content-Type**: `multipart/form-data`

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `file` | File | ✅ | Archivo PDF a procesar (máx 64MB) |
| `record_id` | String | ✅ | ID único del registro |
| `document_name` | String | ✅ | Nombre del documento (LOP, POLICY, CERTIFICATE, etc.) |
| `context` | JSON String | ✅ | Variables de contexto para reemplazo en prompts |

#### Ejemplo de Context JSON

```json
{
  "insured_name": "John Doe",
  "insurance_company": "Citizens Property Insurance Corporation",
  "insured_address": "123 Main St, Tampa, FL 33607",
  "insured_street": "123 Main St",
  "insured_city": "Tampa",
  "insured_zip": "33607",
  "date_of_loss": "08-30-23",
  "policy_number": "POL-123456789",
  "claim_number": "CLM-987654321",
  "type_of_job": "Roof Repair",
  "cause_of_loss": "Hurricane"
}
```

#### Respuesta Exitosa

**Status Code**: `200 OK`

```json
{
  "record_id": "175568",
  "status": "success",
  "results": {
    "LOP.pdf": [
      {
        "pmc_field": "lop_responses",
        "question": "Extract the following 18 data points from this Letter of Protection document...",
        "answer": "YES;08-30-23;YES;YES;123 Main St;33607;Tampa;FL Florida;08-30-23;POL-123456789;CLM-987654321;YES;YES;YES;YES;YES;YES;YES",
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

#### Respuesta de Error

**Status Code**: `200 OK` (con error en contenido)

```json
{
  "record_id": "175568",
  "status": "error",
  "results": {},
  "summary": {
    "total_documents": 1,
    "processed_documents": 0,
    "total_fields": 0,
    "answered_fields": 0
  },
  "errors": [
    "No prompt configuration found for document: INVOICES"
  ],
  "processed_at": "2025-09-20T12:00:00.000Z"
}
```

## Tipos de Documentos

### LOP.pdf (Letter of Protection)

**PMC Field**: `lop_responses`
**Campos**: 18
**Formato**: `mechanics_lien;lop_date1;lop_signed_by_client1;lop_signed_by_ho1;onb_street1;onb_zip1;onb_city1;state1;onb_date_of_loss1;onb_policy_number1;onb_claim_number1;onb_street_match;onb_zip_match;onb_address_match;onb_city_match;onb_date_of_loss_match;onb_policy_number_match;onb_claim_number_match`

**Ejemplo de Respuesta**:
```
"YES;08-30-23;YES;YES;123 Main St;33607;Tampa;FL Florida;08-30-23;POL-123456789;CLM-987654321;YES;YES;YES;YES;YES;YES;YES"
```

### POLICY.pdf (Insurance Policy)

**PMC Field**: `policy_responses`
**Campos**: 7
**Formato**: `policy_valid_from1;policy_valid_to1;matching_insured_name;matching_insured_company;policy_covers_type_job;policy_exclusion;policy_covers_dol`

**Ejemplo de Respuesta**:
```
"04-20-23;04-20-24;YES;YES;YES;NOT_FOUND;YES"
```

### CERTIFICATE.pdf (Completion Certificate)

**PMC Field**: `certificate_responses`
**Campos**: 1
**Formato**: `completion_date`

**Ejemplo de Respuesta**:
```
"08-28-25"
```

### ROOF.pdf (Roof Report)

**PMC Field**: `roof_responses`
**Campos**: 1
**Formato**: `total_area_sqft`

**Ejemplo de Respuesta**:
```
"2250"
```

### WEATHER.pdf (Weather Report)

**PMC Field**: `weather_responses`
**Campos**: 2
**Formato**: `wind_speed;wind_gust`

**Ejemplo de Respuesta**:
```
"41;63"
```

## Enrutamiento de Procesamiento

| Tamaño de Archivo | Método de Procesamiento | Características |
|-------------------|------------------------|-----------------|
| < 1MB | Gemini Inline API | Más rápido, ideal para documentos pequeños |
| 1MB - 50MB | Gemini File API | Balanceado, para documentos medianos |
| > 50MB | File API + División | División automática por páginas |

## Códigos de Error

| Código | Mensaje | Descripción |
|--------|---------|-------------|
| `no_prompt_config` | "No prompt configuration found for document: {name}" | Documento no configurado en base de datos |
| `file_too_large` | "File exceeds maximum size limit" | Archivo supera límite de 64MB |
| `invalid_context` | "Invalid or missing context JSON" | Contexto malformado o ausente |
| `processing_failed` | "Gemini processing failed" | Error en procesamiento AI |

## Rate Limiting

- **Límite**: 30 requests por minuto por IP
- **Window**: 60 segundos
- **Header de Respuesta**: `X-RateLimit-Remaining`

## Headers Recomendados

```http
Content-Type: multipart/form-data
Accept: application/json
User-Agent: YourApp/1.0
```

## Ejemplos de Integración

### cURL

```bash
curl -X POST "http://localhost:5045/api/underwriting/evaluate-gemini" \
  -F "file=@/path/to/document.pdf" \
  -F "record_id=175568" \
  -F "document_name=LOP" \
  -F 'context={"insured_name":"John Doe","date_of_loss":"08-30-23"}'
```

### JavaScript (fetch)

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('record_id', '175568');
formData.append('document_name', 'LOP');
formData.append('context', JSON.stringify({
  insured_name: 'John Doe',
  date_of_loss: '08-30-23'
}));

const response = await fetch('/api/underwriting/evaluate-gemini', {
  method: 'POST',
  body: formData
});

const result = await response.json();
```

### Python (requests)

```python
import requests

files = {'file': open('document.pdf', 'rb')}
data = {
    'record_id': '175568',
    'document_name': 'LOP',
    'context': '{"insured_name":"John Doe","date_of_loss":"08-30-23"}'
}

response = requests.post(
    'http://localhost:5045/api/underwriting/evaluate-gemini',
    files=files,
    data=data
)

result = response.json()
```

## Logging y Debug

### Logs de Validación

Buscar en logs estas líneas para validación rápida:

```log
🎯 [VALIDATION] LOP.pdf → "YES;08-30-23;YES;YES;..."
🎯 [VALIDATION] POLICY.pdf → "04-20-23;04-20-24;YES;YES;..."
```

### Logs de Variables

Para debug de variables de contexto:

```log
📋 [VAR-DEBUG] Variables found: %insured_name%="John Doe", %date_of_loss%="08-30-23"
✅ [PURE-GEMINI] Replaced %insured_name% with "John Doe"
```

### Logs de Enrutamiento

Para verificar qué método de procesamiento se utilizó:

```log
🟢 [GEMINI-DOC] LOP: Inline API (0.97MB < 1MB)
🟡 [GEMINI-DOC] POLICY: File API (2.53MB ≤ 50MB)
🔴 [GEMINI-DOC] LARGE_DOC: File API + Split (66.1MB > 50MB)
```