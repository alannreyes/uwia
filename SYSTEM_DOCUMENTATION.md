# 📚 CLAIMPAY UWIA System - Documentación Completa

## 🎯 **Resumen del Sistema**

El sistema **UWIA (Underwriting Intelligence Automation)** automatiza el análisis de documentos de seguros usando **n8n** como orquestador y una **API NestJS con Gemini** para el procesamiento inteligente. El flujo procesa múltiples documentos PDF desde Google Drive y extrae información específica usando IA generativa.

---

## 🔄 **Flujo Principal n8n → API**

### **Diagrama del Flujo**
```
[Webhook] → [Validar Entrada] → [Listar PDFs] → [Filtrar] → [Descargar] → [API UWIA con Gemini] → [Consolidar] → [Enviar Resultado]
```

---

## 📋 **Flujo Detallado Paso a Paso**

### **1. 🚀 Inicio del Flujo (Webhook)**
- **Trigger:** POST a `https://n8n.claimpay.net/webhook/UWIA`
- **Input requerido:**
  ```json
  {
    "carpeta_id": "15tgwSI87yzODYZ8qHN_rpS50PryN23S6",
    "record_id": "017200281",
    "insured_name": "JOSE ESQUIVEL and JOSEFINA ESQUIVEL",
    "insurance_company": "INTERINSURANCE EXCHANGE",
    "insured_address": "525 DE ANZA WAY, OXNARD, CA 93033-6566",
    "type_of_job": "wind damage",
    "date_of_loss": "10-15-24"
  }
  ```

### **2. ✅ Validación y Procesamiento (Nodo: Validar Entrada)**
- **Función:** Valida `carpeta_id` y `record_id` (únicos campos obligatorios)
- **Procesamiento:** 
  - Extrae **variables fijas**: `carpeta_id`, `record_id`
  - Agrupa **todo lo demás** en objeto `context`
  - Genera `timestamp` para tracking
- **Output:**
  ```json
  {
    "carpeta_id": "15tgwSI87yzODYZ8qHN_rpS50PryN23S6",
    "record_id": "017200281", 
    "context": {
      "insured_name": "JOSE ESQUIVEL and JOSEFINA ESQUIVEL",
      "insurance_company": "INTERINSURANCE EXCHANGE",
      // ... resto de variables
    },
    "timestamp": "202410141030"
  }
  ```

### **3. 📁 Búsqueda de Documentos (Nodo: Listar Archivos Drive)**
- **Función:** Busca PDFs en Google Drive usando `carpeta_id`
- **Query:** `mimeType='application/pdf' and not name contains 'ITL_SUM'`
- **Excluye:** Archivos ITL_SUM, carpetas, shortcuts

### **4. 🔍 Filtrado y Preparación (Nodo: Filtrar y Ordenar)**
- **Límites aplicados:**
  - Máximo **10MB** por archivo
  - Máximo **20 archivos** total
  - Solo archivos **PDF válidos**
- **Orden:** Alfabético por nombre
- **Output:** Lista de archivos con metadata completa

### **5. ⬇️ Descarga de Archivos (Nodo: Descargar Archivo)**
- **Función:** Descarga cada PDF de Google Drive
- **Preparación:** Convierte a binario para envío al API

### **6. 🤖 Procesamiento con IA (Nodo: HTTP Request → API)**
- **Endpoint:** `http://automate_uwia_qa:5045/api/underwriting/evaluate-gemini`
- **Método:** POST multipart/form-data
- **Payload:**
  ```
  carpeta_id: "15tgwSI87yzODYZ8qHN_rpS50PryN23S6"
  record_id: "017200281"
  document_name: "POLICY" (sin .pdf)
  context: "{\"insured_name\":\"JOSE ESQUIVEL\",...}"
  file: [archivo_binario.pdf]
  ```

---

## 🎯 **Procesamiento en el API UWIA (con Gemini)**

### **Arquitectura del API**
```
[Endpoint] → [Routing Logic] → [Gemini Processing] → [Response Consolidation]
```

### **Lógica de Enrutamiento Inteligente**
El API aplica **detección automática** para elegir el mejor método:

```typescript
// Criterios de detección
const shouldUseGeminiFileApi = (file) => {
  const fileSizeMB = file.size / (1024 * 1024);
  const isLargeFile = fileSizeMB > 30;
  const hasLowTextDensity = charsPerMB < 100;
  const isScannedDocument = fontDensity < 0.5;
  
  return isLargeFile || hasLowTextDensity || isScannedDocument;
}
```

### **Métodos de Procesamiento:**

#### **🔸 Método 1: Gemini Inline API** 
- **Para:** Archivos < 1MB con texto extraíble
- **Ventajas:** Respuesta rápida, menor costo
- **Límite:** 1MB (ultra-conservador)

#### **🔸 Método 2: Gemini File API**
- **Para:** Archivos 1-66MB+ o documentos escaneados
- **Ventajas:** OCR avanzado, manejo de archivos grandes
- **Capacidades:** Hasta 66MB+ con división automática

#### **🔸 Método 3: Modern RAG 2025** 
- **Para:** Archivos muy grandes con texto extraíble
- **Proceso:** Embeddings → Similarity Search → Synthesis
- **Embeddings:** Gemini text-embedding-004 (768 dims)

### **Obtención de Prompts (DB-First)**
```sql
-- El API consulta la tabla document_consolidado
SELECT consolidated_prompt, field_names, expected_fields_count 
FROM document_consolidado 
WHERE document_name = 'POLICY.pdf' AND active = 1;
```

### **Sustitución de Variables**
El prompt usa **template variables** que se reemplazan con el contexto:
```
Original: "Compare with %insured_name%"
Procesado: "Compare with JOSE ESQUIVEL and JOSEFINA ESQUIVEL"
```

### **Formato de Respuesta API**
```json
{
  "results": {
    "POLICY.pdf": [{
      "pmc_field": "policy_responses",
      "answer": "10-15-24;11-15-25;YES;YES;NOT_FOUND;YES",
      "confidence": 0.95,
      "processing_time_ms": 4500,
      "method": "gemini-file-api"
    }]
  }
}
```

---

## 🔄 **Consolidación Final en n8n**

### **7. 📊 Preparación del JSON Final (Nodo: Preparar Json)**

#### **Mapeo de Campos Automático**
El nodo tiene configurados **TODOS los campos posibles** de todos los documentos:

```javascript
const ALL_POSSIBLE_FIELDS = {
  'lop_responses': [
    "mechanics_lien", "lop_date1", "lop_signed_by_client1", 
    "lop_signed_by_ho1", "onb_street1", "onb_zip1", // ... 18 campos
  ],
  'policy_responses': [
    "policy_valid_from1", "policy_valid_to1", "matching_insured_name",
    "matching_insured_company", "policy_covers_type_job", // ... 7 campos
  ],
  'weather_responses': ["windspeed1", "wind_gust1"],
  'certificate_responses': ["date_of_completion1"],
  'roof_responses': ["roof_area_report"],
  'estimate_responses': ["signed_insured_next_amount"],
  'mold_responses': ["mold_test_report"]
};
```

#### **Proceso de Consolidación**
1. **Inicializar** todos los campos como vacíos (`''`)
2. **Procesar respuestas** del API por documento
3. **Separar valores** por punto y coma (`;`)
4. **Mapear** cada valor a su campo correspondiente
5. **Limpiar datos** (convertir NOT_FOUND → vacío)

#### **Resultado Consolidado**
```json
{
  "record_id": "017200281",
  "uw_processing_finished": "YES",
  "uw_processing_finished_time": "10-14-2025 10:30",
  
  // Campos LOP (18)
  "mechanics_lien": "YES",
  "lop_date1": "10-15-24", 
  "lop_signed_by_client1": "YES",
  // ... resto de campos LOP
  
  // Campos POLICY (7)  
  "policy_valid_from1": "10-15-24",
  "policy_valid_to1": "11-15-25",
  "matching_insured_name": "YES",
  // ... resto de campos POLICY
  
  // Campos WEATHER (2)
  "windspeed1": "45",
  "wind_gust1": "65",
  
  // Campos individuales
  "date_of_completion1": "10-20-24",
  "roof_area_report": "2250",
  "signed_insured_next_amount": "YES",
  "mold_test_report": "Negative"
}
```

### **8. 🔐 Autenticación (Nodo: HTTP Request2)**
- **Login** a ClaimPay API para obtener token
- **Headers:** API key + Authorization básica

### **9. 📤 Envío Final (Nodo: Envia Rpta)**
- **Endpoint:** `PUT https://login.claimpay.net/webservice/Claims/Record/{record_id}`
- **Payload:** JSON consolidado completo
- **Headers:** Token de autenticación

---

## 📋 **Documentos Procesados y Campos**

| Documento | Campos | Descripción |
|-----------|--------|-------------|
| **LOP.pdf** | 18 | Letter of Protection - Firmas, datos del propietario, comparaciones |
| **POLICY.pdf** | 7 | Póliza de seguro - Vigencia, cobertura, exclusiones |
| **WEATHER.pdf** | 2 | Datos meteorológicos - Velocidad viento y ráfagas |
| **CERTIFICATE.pdf** | 1 | Certificado de finalización - Fecha de terminación |
| **ROOF.pdf** | 1 | Reporte de techo - Área total en pies cuadrados |
| **ESTIMATE.pdf** | 1 | Estimación - Firma de aprobación de monto |
| **MOLD.pdf** | 1 | Reporte de moho - Positivo/Negativo |

---

## ⚙️ **Gestión de Prompts (Solo desde n8n)**

### **Actualización de Prompts**
- **Nodo:** "Actualizar de Prompts" (Manual Trigger)
- **Función:** Ejecuta queries SQL para actualizar `document_consolidado`
- **Control total:** Desde n8n se modifica la lógica de extracción

### **Tabla document_consolidado**
```sql
CREATE TABLE document_consolidado (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_name VARCHAR(255) NOT NULL,     -- 'POLICY.pdf'
    consolidated_prompt TEXT NOT NULL,       -- Prompt completo
    field_names JSON NOT NULL,               -- Array de campos esperados
    expected_fields_count INT NOT NULL,      -- Número de campos
    active BOOLEAN DEFAULT TRUE,             -- Habilitado/Deshabilitado
    pmc_field VARCHAR(100),                  -- 'policy_responses'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔧 **Configuración y Variables**

### **Variables de Entorno API**
```env
# Base de datos
DB_HOST=localhost
DB_PORT=3306
DB_DATABASE=production_db
DOCUMENT_PROMPTS_TABLE_NAME=document_consolidado

# Gemini Configuration
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-1.5-pro

# Límites
MAX_FILE_SIZE=31457280  # 30MB
LARGE_PDF_THRESHOLD_MB=30
```

### **Credenciales n8n**
- **Google Drive OAuth2:** Para acceso a carpetas
- **MySQL:** Para actualización de prompts
- **ClaimPay API:** Para envío de resultados

---

## 📊 **Métricas y Monitoreo**

### **Logs del API**
```
🎯 [VALIDATION] POLICY.pdf → 7 campos esperados
🚀 [PROCESSING] Usando Gemini File API (66.14MB, PDF escaneado)
⏱️ [TIMING] Procesamiento completado en 4.5s
✅ [SUCCESS] Respuesta consolidada enviada
```

### **Flujo de Error**
- **Retry automático:** 3 intentos con 5s de espera
- **Continue on error:** El flujo continúa con otros documentos
- **Logs detallados:** Para debugging y auditoría

---

## 🚀 **Ventajas del Sistema Actual**

### **🔸 Escalabilidad**
- Procesamiento paralelo de múltiples documentos
- Enrutamiento inteligente según características del archivo
- Límites configurables de archivos y tamaño

### **🔸 Flexibilidad**
- Prompts completamente configurables desde n8n
- Variables dinámicas en contexto
- Campos consolidados automáticamente

### **🔸 Robustez**
- Detección automática de PDFs escaneados
- Fallbacks inteligentes entre métodos de IA
- Manejo graceful de errores y timeouts

### **🔸 Integración**
- Single API endpoint para n8n
- Respuesta estructurada y predecible
- Trazabilidad completa del proceso

---

## 🎯 **Próximos Pasos Recomendados**

1. **📈 Monitoreo avanzado** - Métricas de accuracy por documento
2. **🔄 Optimización** - Cache de prompts frecuentes  
3. **📊 Analytics** - Dashboard de procesamiento en tiempo real
4. **🛡️ Seguridad** - Encriptación de datos sensibles en tránsito

---

*Documentación actualizada: Octubre 2025 - Sistema 100% funcional con Gemini*
