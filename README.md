# UWIA - Underwriting Inteligente con IA

Sistema backend enterprise en NestJS para procesamiento inteligente de documentos de underwriting utilizando **GPT-4o + Gemini 2.5 Pro** con **RAG (Retrieval Augmented Generation)**.

## 🚀 Características Principales

- **🤖 Dual AI Processing**: GPT-4o como motor principal + Gemini 2.5 Pro para validación complementaria
- **🧠 RAG Comprehensive**: Sistema de recuperación inteligente que usa 100% de chunks del documento para máxima precisión
- **📄 Análisis Visual Inteligente**: Procesamiento de PDFs con OCR + Vision API para documentos complejos
- **⚡ Respuestas Consolidadas**: Un documento = una respuesta con múltiples valores separados por semicolons
- **🎯 Fusion Logic**: Algoritmo inteligente que combina resultados de visión y texto para campos críticos
- **🔄 Validación Complementaria**: Múltiples fuentes procesan independientemente, el mejor resultado gana
- **📊 Enterprise Logging**: Logs limpios y profesionales sin spam de contenido
- **🛡️ Rate Limiting Inteligente**: Manejo automático de límites de API con fallbacks robustos
- **⚡ Performance Optimizado**: Thresholds inteligentes (10MB/150MB) con procesamiento directo para archivos medianos
- **🎯 Vector Storage**: Sistema de embeddings con OpenAI text-embedding-3-large (3072 dimensiones)
- **🔧 PDF Toolkit Unificado**: Arquitectura robusta que combina pdf-parse, pdf-lib y pdfjs-dist

## 🧠 Post-proceso Determinístico

- **Campos `*_match`**: Recalculados programáticamente (street/zip/city/address/DOL/policy/claim) con normalización robusta.
- **Address match**: Mantiene `state1` en formato requerido (ej. `FL Florida`) pero para validar la dirección usa solo la abreviatura (`FL`) y limpia puntuación/espacios.
- **LOP mechanics_lien**: Si la IA devuelve `NO/NOT_FOUND` y el texto contiene evidencia fuerte (p.ej., “lien upon proceeds”, “construction lien law”), se ajusta a `YES`.

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
        ├── chunking/# Vector embeddings & storage
        └── services/# Servicios principales (ver detalle abajo)
            ├── underwriting.service.ts      # 🎯 Orquestador principal
            ├── pdf-toolkit.service.ts       # 📄 Procesamiento PDF unificado
            ├── pdf-parser.service.ts        # 📋 Parsing y extracción
            ├── semantic-chunking.service.ts # 🧩 División inteligente
            ├── vector-storage.service.ts    # 🗄️ Almacenamiento vectorial
            ├── modern-rag.service.ts        # 🧠 RAG comprehensive
            ├── openai.service.ts           # 🤖 GPT-4o integration
            ├── gemini.service.ts           # 🔮 Gemini 2.5 Pro integration
            └── large-pdf-vision.service.ts # 👁️ Análisis visual avanzado
```

## 🏗️ Arquitectura Técnica

### Stack de Tecnologías Core

```
┌─ NestJS Framework ─────────────────────────────┐
│  ├── TypeScript + Decorators                  │
│  ├── Dependency Injection                     │
│  ├── MySQL + TypeORM                          │
│  └── Modular Architecture                     │
├─ AI Processing Layer ─────────────────────────┤
│  ├── OpenAI GPT-4o (text-davinci-003+)       │
│  ├── Google Gemini 2.5 Pro (vision + text)   │
│  ├── OpenAI Embeddings (text-embedding-3-large) │
│  └── Dual AI Fusion Logic                    │
├─ PDF Processing Stack ────────────────────────┤
│  ├── pdf-parse (fast text extraction)        │
│  ├── pdf-lib (forms + metadata)              │
│  ├── pdfjs-dist (advanced rendering)         │
│  ├── canvas (image conversion)               │
│  └── pdf-to-png-converter (fallback)         │
├─ Vector Storage & RAG ────────────────────────┤
│  ├── MySQL JSON columns (embeddings)         │
│  ├── Cosine similarity search                │
│  ├── Semantic chunking (8KB optimized)       │
│  └── Comprehensive chunk retrieval           │
└─ Performance & Reliability ───────────────────┤
   ├── Rate limiting (OpenAI: 30 RPM, Gemini: 80 RPM)
   ├── Automatic fallbacks & retries         │
   ├── Progress tracking & grouped logging    │
   └── Memory optimization for 100MB+ files  │
```

## 🔄 Flujo de Procesamiento

### Arquitectura del Sistema

```
📄 DOCUMENTO PDF → 📋 ANÁLISIS → 🤖 IA DUAL → 🎯 FUSION → ✅ RESPUESTA
```

### Flujo Detallado Paso a Paso

#### 1. **Recepción del Documento** 📥
```
POST /api/underwriting/evaluate-claim-multipart
├── Validación de archivo (tamaño, formato)
├── Extracción de contexto (record_id, document_name)
├── Carga de configuración desde DB (document_consolidado)
└── Inicio de sesión de procesamiento
```

#### 2. **Procesamiento PDF** 📄
```
PDF Toolkit Service
├── 📝 Extracción de texto (pdf-parse, pdfjs-dist)
├── 🖼️ Conversión a imágenes (canvas + PDF.js)
├── 📋 Detección de formularios (pdf-lib)
├── ✍️ Identificación de firmas
└── 🔍 Análisis OCR si es necesario
```

#### 3. **Chunking Semántico** 🧩
```
Semantic Chunking Service
├── División en chunks de 8KB optimizados
├── Generación de embeddings (OpenAI text-embedding-3-large)
├── Metadata enriquecido (fechas, nombres, números)
├── Almacenamiento en vector database
└── Indexado por sessionId para recuperación
```

#### 4. **Análisis RAG Comprehensive** 🧠
```
Modern RAG Service
├── Recuperación del 100% de chunks (getAllChunksForSession)
├── Ensamblaje de contexto completo
├── Sustitución de variables (%insured_name%, %date_of_loss%)
├── Preparación de prompt consolidado
└── Contextualización inteligente
```

#### 5. **Procesamiento IA Dual** 🤖
```
Procesamiento Paralelo:
┌─ GPT-4o (Texto) ────────────┐
│  ├── Análisis de contexto   │
│  ├── Extracción de campos   │  ➤ Respuesta Principal
│  └── Validación lógica      │
└─ Gemini 2.5 Pro (Visión) ──┘
   ├── Análisis visual OCR
   ├── Detección de elementos
   └── Validación complementaria ➤ Respuesta Secundaria
```

#### 6. **Fusion Logic** 🎯
```
Algoritmo de Fusión Inteligente:
├── Campo por campo: GPT vs Gemini
├── Selección por confianza y especificidad
├── Prioridad a respuestas más detalladas
├── Validación cruzada de fechas/números
└── Consolidación final sin duplicados
```

#### 7. **Post-procesamiento Determinístico** ⚙️
```
Validación Automática:
├── Recálculo de campos *_match (street, zip, city, address)
├── Normalización de direcciones y estados
├── Validación de LOP mechanics_lien con evidencia textual
├── Verificación de formato de respuestas
└── Aplicación de reglas de negocio
```

#### 8. **Respuesta Consolidada** ✅
```
Formato Final:
├── Un documento = una respuesta (18 campos para LOP)
├── Valores separados por semicolons (;)
├── Campos ordenados según field_names en DB
├── Confidence score y tiempo de procesamiento
└── Metadata de sesión para trazabilidad
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
- **document_consolidado**: Tabla principal de configuración de documentos

## 🛡️ Seguridad

- **🔐 API Keys**: Nunca incluir keys en código - usar variables de entorno
- **🔑 Dual Authentication**: OpenAI + Gemini keys deben mantenerse seguras
- **✅ Validación de Entrada**: Rate limiting y validación en todos endpoints
- **📊 Logs de Auditoría**: Trazabilidad completa para producción
- **🚫 No Logging de Contenido**: Los contenidos de documentos no se almacenan en logs
- **🔒 CORS**: Configurado para orígenes específicos en producción

## ⚡ Performance y Benchmarks

### Tiempos Optimizados de Procesamiento (Sept 2025):
- **Documentos pequeños** (< 10MB): 5-15 segundos ⚡ *Inline API*
- **Documentos medianos** (10-150MB): 20-40 segundos ✨ *File API Direct*
- **Documentos grandes** (> 150MB): 60+ segundos 📄 *Page-based splitting*

**Ejemplo real**: POLICY.pdf (31.43MB) procesa en **30.4 segundos** ✅

### Optimizaciones Activas:
- ✅ **Thresholds inteligentes** - 10MB/150MB para procesamiento óptimo
- ✅ **File API Direct** - Sin splitting para archivos medianos (10-150MB)
- ✅ **Eliminación del bug pdf-lib** - No más inflación de tamaño
- ✅ **Respuestas consolidadas** - Un documento = una respuesta
- ✅ **Dual AI validation** con selección inteligente
- ✅ **Rate limiting adaptativo** con fallbacks automáticos

## Contribución

1. Fork el proyecto
2. Crear feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## Licencia

Este proyecto está bajo licencia MIT.

## 🆘 Troubleshooting

### Errores Comunes Resueltos ✅

| Error | Causa | Solución Implementada | Estado |
|-------|-------|----------------------|---------|
| **Duplicación de Campos** | Double parseConsolidatedResponse en fusion logic | Eliminada llamada redundante en underwriting.service.ts | ✅ **SOLUCIONADO** |
| **Base64 Log Spam** | Logging completo de file_data | Limpieza en 7 archivos - solo field names | ✅ **SOLUCIONADO** |
| **RAG Selectivo** | Solo 10 chunks de 49 disponibles | Implementado getAllChunksForSession (100%) | ✅ **SOLUCIONADO** |
| **Sample Data Contamination** | Datos de prueba contaminando análisis real | Deshabilitado loadSampleDocuments automático | ✅ **SOLUCIONADO** |
| **Variable Substitution Bug** | Prompt templates mal procesados | Corregido question variable en RAG service | ✅ **SOLUCIONADO** |

### Errores Actuales:

| Error | Causa | Solución |
|-------|-------|----------|
| `GEMINI_ERROR` | API key inválida | Verificar `GEMINI_API_KEY` |
| `TIMEOUT` | Archivo muy grande | Ajustar `LARGE_FILE_TIMEOUT` |
| `RATE_LIMIT` | Demasiadas requests | Esperar o ajustar RPM límites |
| `NOT_FOUND` | Documento no configurado | Verificar tabla `document_consolidado` |
| `CONSOLIDATED_MISMATCH` | Respuesta no coincide con campos | Verificar prompt en DB |
| ⚠️ **Font Warnings** | PDF.js canvas font loading | Warnings suprimidos - no afectan funcionalidad |

### Optimizaciones Aplicadas 🚀

- **Logging Agrupado**: Chunks procesados cada 10 (10/88, 20/88, etc.)
- **Base64 Cleanup**: Solo nombres de campos en logs
- **RAG Comprehensive**: 100% de chunks utilizados
- **Fusion Logic**: Campo por campo sin duplicaciones
- **Canvas Warnings**: Interceptados y suprimidos
- **Vector Storage**: Cache + DB híbrido
- **Progress Tracking**: Mejor visibilidad de procesamiento

### Comandos Útiles:

```bash
# Ver logs en tiempo real (Docker)
docker logs -f container_name

# Verificar salud del sistema
curl http://localhost:5035/api/underwriting/health

# Verificar configuración de documento
SELECT * FROM document_consolidado WHERE document_name = 'LOP.pdf';

# Verificar chunks en vector storage
SELECT COUNT(*) FROM document_embeddings WHERE sessionId = 'your-session-id';

# Monitorear memoria y performance
pm2 monit uwia
```

### Debug de Fusion Logic 🔍

Para verificar decisiones campo por campo:

```bash
# Los logs muestran:
🎯 [FUSION] Field mechanics_lien: GPT='NO' vs Gemini='YES' → Selected: YES (higher confidence)
🎯 [FUSION] Field lop_date1: GPT='07-18-25' vs Gemini='07-18-25' → Selected: 07-18-25 (consensus)
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
