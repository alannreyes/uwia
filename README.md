# UWIA - Underwriting Inteligente con IA

Sistema backend enterprise en NestJS para procesamiento inteligente de documentos de underwriting utilizando **GPT-4o + Gemini 2.5 Pro**.

## 🚀 Características Principales

- **🤖 Dual AI Processing**: GPT-4o como motor principal + Gemini 2.5 Pro para validación complementaria
- **📄 Análisis Visual Inteligente**: Procesamiento de PDFs con OCR + Vision API para documentos complejos
- **⚡ Respuestas Consolidadas**: Un documento = una respuesta con múltiples valores separados por semicolons
- **🎯 Estrategia Adaptativa**: Selección automática de procesamiento (visual vs texto) basada en contenido
- **🔄 Validación Complementaria**: Ambos modelos procesan independientemente, el mejor resultado gana
- **📊 Enterprise Logging**: Trazabilidad completa para auditoría y debugging en producción
- **🛡️ Rate Limiting Inteligente**: Manejo automático de límites de API con fallbacks robustos
- **⚙️ Performance Optimizado**: Chunking inteligente para documentos grandes (50MB+)

## 📋 Documentos Soportados

El sistema procesa **7 tipos de documentos** con respuestas consolidadas:

| Documento | pmc_field | Campos | Función Principal |
|-----------|-----------|--------|-------------------|
| **LOP.pdf** | `lop_responses` | 18 | Liens, firmas, direcciones, comparaciones |
| **POLICY.pdf** | `policy_responses` | 9 | Fechas de póliza, cobertura, exclusiones |
| **WEATHER.pdf** | `weather_responses` | 2 | Velocidad de viento y ráfagas |
| **CERTIFICATE.pdf** | `certificate_responses` | 1 | Fecha de completación de trabajo |
| **ESTIMATE.pdf** | `estimate_responses` | 1 | Firma de aprobación de monto |
| **MOLD.pdf** | `mold_responses` | 1 | Condiciones de moho (Positive/Negative) |
| **ROOF.pdf** | `roof_responses` | 1 | Área total del techo en pies² |

## 📦 Requisitos Previos

- Node.js 20+
- MySQL 8.0+
- Docker (para producción)
- **OpenAI API Key** con acceso a GPT-4o
- **Google Gemini API Key** con acceso a Gemini 2.5 Pro
- Mínimo 4GB RAM (8GB recomendado para archivos grandes)

## Instalación

1. Clonar el repositorio:
```bash
git clone https://github.com/[tu-usuario]/uwia.git
cd uwia
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno:
```bash
cp env.example .env
# Editar .env con tus credenciales
```

4. Ejecutar scripts de base de datos:
```bash
mysql -u [usuario] -p < database/scripts/01_create_database.sql
mysql -u [usuario] -p < database/scripts/02_create_tables.sql
mysql -u [usuario] -p < database/scripts/03_create_indexes.sql
```

## Configuración

### Variables de Entorno

```env
# ===== API Configuration =====
PORT=5035
NODE_ENV=production

# ===== Base de Datos =====
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=your_user
DB_PASSWORD=your_password
DB_DATABASE=axioma
DOCUMENT_PROMPTS_TABLE_NAME=document_consolidado

# ===== OpenAI GPT-4o =====
OPENAI_API_KEY=sk-proj-your-key-here
OPENAI_MODEL=gpt-4o
OPENAI_ENABLED=true
OPENAI_TIMEOUT=90000
OPENAI_TEMPERATURE=0.1
OPENAI_MAX_TOKENS=8192
OPENAI_VISION_TEMPERATURE=0.1
OPENAI_RATE_LIMIT_RPM=30
OPENAI_RATE_LIMIT_TPM=30000
OPENAI_MAX_RETRIES=5

# ===== Gemini 2.5 Pro =====
GEMINI_API_KEY=AIzaSy-your-key-here
GEMINI_ENABLED=true
GEMINI_MODEL=gemini-2.5-pro
GEMINI_TEMPERATURE=0.1
GEMINI_MAX_TOKENS=8192
GEMINI_THINKING_MODE=true
GEMINI_RATE_LIMIT_RPM=80
GEMINI_RATE_LIMIT_TPM=1500000
GEMINI_TIMEOUT=120000
GEMINI_MAX_RETRIES=3
GEMINI_AUTO_FALLBACK=true

# ===== Procesamiento =====
MAX_FILE_SIZE=104857600  # 100MB
LARGE_FILE_TIMEOUT=300000  # 5 minutos
LOCAL_PROCESSING_DEFAULT=false
MAX_PAGES_TO_CONVERT=10

# ===== Logging =====
LOG_LEVEL=info
ENABLE_DOCUMENT_START_END_LOGS=true
ENABLE_FIELD_SUCCESS_LOGS=false
ENABLE_VISION_API_LOGS=false
```

## Uso

### Desarrollo
```bash
npm run start:dev
```

### Producción
```bash
npm run build
npm run start:prod
```

### Testing
```bash
npm run test
npm run test:e2e
npm run test:cov
```

## Estructura del Proyecto

```
src/
├── config/          # Configuraciones (DB, OpenAI, etc)
├── common/          # Utilidades compartidas
│   ├── filters/     # Filtros de excepciones
│   ├── interceptors/# Interceptores (logging, etc)
│   └── validators/  # Validadores personalizados
└── modules/
    └── underwriting/
        ├── dto/     # Data Transfer Objects
        ├── entities/# Entidades de base de datos
        └── services/# Lógica de negocio
```

## 🛠️ API Endpoints

### Health Check
```bash
GET /api/underwriting/health
```

### Procesar Documento Individual (Multipart)
```bash
POST /api/underwriting/evaluate-claim-multipart
Content-Type: multipart/form-data

# Form Data:
record_id: "175568"
document_name: "LOP"  # LOP | POLICY | WEATHER | CERTIFICATE | etc.
context: '{"insured_name":"John Doe","policy_number":"12345",...}'
file: [PDF file]
```

### Respuesta Consolidada Típica:
```json
{
  "record_id": "175568",
  "status": "success",
  "results": {
    "LOP.pdf": [
      {
        "pmc_field": "lop_responses",
        "question": "Analyze this document and extract the following information...",
        "answer": "NO;NOT_FOUND;YES;YES;NOT_FOUND;...",
        "confidence": 1.0,
        "processing_time_ms": 104590,
        "error": null
      }
    ]
  },
  "summary": {
    "total_documents": 1,
    "processed_documents": 1,
    "total_fields": 18,
    "answered_fields": 15
  }
}
```

### Procesar Lote de Documentos
```bash
POST /api/underwriting/evaluate-claim-batch
Content-Type: application/json

{
  "record_id": "175568",
  "carpeta_id": "folder_id",
  "context": {...},
  "documents": [
    {
      "document_name": "LOP",
      "file_data": "base64_encoded_pdf"
    },
    {
      "document_name": "POLICY", 
      "file_data": "base64_encoded_pdf"
    }
  ]
}
```

## 🗄️ Base de Datos

### Tabla Principal: `document_consolidado`

La configuración de documentos se maneja desde la tabla `document_consolidado`:

| Campo | Descripción |
|-------|-------------|
| `id` | ID único del documento |
| `document_name` | Nombre del documento (ej: "LOP.pdf") |
| `pmc_field` | Campo consolidado de respuesta (ej: "lop_responses") |
| `question` | Prompt consolidado con instrucciones completas |
| `field_names` | JSON array con nombres de campos individuales |
| `expected_fields_count` | Número de campos esperados |
| `expected_type` | Tipo de respuesta esperado |
| `active` | Si está activo (1) o no (0) |

### Ejemplo de Registro:
```sql
INSERT INTO document_consolidado VALUES (
  1, 
  'LOP.pdf', 
  'lop_responses',
  'Analyze this document and extract the following information in order: determine if there is any language related to liens...',
  '["mechanics_lien","lop_date1","lop_signed_by_client1",...]',
  18,
  'TEXT',
  1
);
```

### Tablas de Evaluación (Legacy):
- **claim_evaluations**: Resultados históricos de evaluaciones
- **document_prompts**: Tabla obsoleta (reemplazada por `document_consolidado`)

## 🛡️ Seguridad

- **🔐 API Keys**: Nunca incluir keys en código - usar variables de entorno
- **🔑 Dual Authentication**: OpenAI + Gemini keys deben mantenerse seguras
- **✅ Validación de Entrada**: Rate limiting y validación en todos endpoints
- **📊 Logs de Auditoría**: Trazabilidad completa para producción
- **🚫 No Logging de Contenido**: Los contenidos de documentos no se almacenan en logs
- **🔒 CORS**: Configurado para orígenes específicos en producción

## ⚡ Performance y Benchmarks

### Tiempos Típicos de Procesamiento:
- **Documentos pequeños** (< 1MB): 5-15 segundos
- **Documentos medianos** (1-10MB): 15-45 segundos  
- **Documentos grandes** (10-50MB): 1-3 minutos
- **Documentos ultra** (50-100MB): 3-8 minutos

### Optimizaciones Activas:
- ✅ **Respuestas consolidadas** - Un documento = una respuesta
- ✅ **Dual AI validation** con selección inteligente  
- ✅ **Chunking inteligente** para documentos grandes
- ✅ **Rate limiting adaptativo** con fallbacks
- ✅ **Caché de conversión** de imágenes
- ✅ **Timeouts escalados** según tamaño de documento

## Contribución

1. Fork el proyecto
2. Crear feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## Licencia

Este proyecto está bajo licencia MIT.

## 🆘 Troubleshooting

### Errores Comunes:

| Error | Causa | Solución |
|-------|-------|----------|
| `GEMINI_ERROR` | API key inválida | Verificar `GEMINI_API_KEY` |
| `TIMEOUT` | Archivo muy grande | Ajustar `LARGE_FILE_TIMEOUT` |
| `RATE_LIMIT` | Demasiadas requests | Esperar o ajustar RPM límites |
| `NOT_FOUND` | Documento no configurado | Verificar tabla `document_consolidado` |
| `CONSOLIDATED_MISMATCH` | Respuesta no coincide con campos | Verificar prompt en DB |

### Comandos Útiles:

```bash
# Ver logs en tiempo real (Docker)
docker logs -f container_name

# Verificar salud del sistema
curl http://localhost:5035/api/underwriting/health

# Verificar configuración de documento
SELECT * FROM document_consolidado WHERE document_name = 'LOP.pdf';
```

## 📞 Soporte

- **Issues**: Crear issue en GitHub con logs detallados
- **Performance**: Incluir métricas de tiempo y tamaño de archivo
- **Configuración**: Verificar variables de entorno antes de reportar

---

**🤖 Sistema Enterprise**: GPT-4o + Gemini 2.5 Pro  
**📊 Respuestas Consolidadas**: Un documento = una respuesta  
**⚡ Performance**: Optimizado para documentos de hasta 100MB  
**🔒 Seguridad**: Enterprise-grade logging y validación