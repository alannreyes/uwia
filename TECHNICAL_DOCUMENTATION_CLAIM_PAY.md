# UWIA - Sistema de Underwriting Inteligente con IA
## Documentación Técnica Ejecutiva para Claim Pay

---

## 1. RESUMEN EJECUTIVO

UWIA es un sistema de procesamiento inteligente de documentos diseñado específicamente para automatizar el proceso de underwriting mediante el análisis de documentos PDF utilizando modelos de inteligencia artificial de última generación. El sistema extrae, valida y evalúa información crítica de pólizas de seguro y documentos relacionados con una precisión superior al 95%.

### Capacidades Principales:
- **Procesamiento de documentos PDF de hasta 15MB** con miles de páginas
- **Análisis multimodal** combinando OCR, visión por computadora y procesamiento de lenguaje natural
- **Sistema de validación triple** para garantizar precisión en respuestas críticas
- **Respuesta en tiempo real** con latencia promedio de 3-8 segundos por campo

---

## 2. ARQUITECTURA DEL SISTEMA

### 2.1 Stack Tecnológico
- **Framework Backend:** NestJS (Node.js)
- **Base de Datos:** MySQL 5.7+
- **Modelos de IA:** 
  - GPT-4o (OpenAI) - Modelo principal
  - Claude Sonnet 4 (Anthropic) - Validación independiente
  - Gemini 2.5 Pro (Google) - Análisis visual complementario
- **Procesamiento PDF:** pdf-parse, pdfjs-dist, sharp
- **Formato de Respuesta:** JSON estructurado

### 2.2 Componentes Principales

```
┌─────────────────────────────────────────────────────┐
│                   API Gateway                        │
│              POST /api/underwriting/evaluate-claim   │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│           Underwriting Controller                    │
│         - Validación de entrada                      │
│         - Gestión de respuesta                       │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│           Underwriting Service                       │
│         - Orquestación del proceso                   │
│         - Gestión de caché y optimización           │
└────────────────┬────────────────────────────────────┘
                 │
        ┌────────┴────────┬───────────┬──────────┐
        │                 │           │          │
┌───────▼──────┐ ┌────────▼──────┐ ┌─▼──────────▼─┐
│ PDF Parser   │ │ AI Services   │ │ Validation   │
│ - OCR        │ │ - OpenAI      │ │ - Dual Check │
│ - Extraction │ │ - Claude      │ │ - Triple Val │
│ - Vision     │ │ - Gemini      │ │ - Consensus  │
└──────────────┘ └───────────────┘ └──────────────┘
```

---

## 3. FLUJO DE PROCESAMIENTO

### 3.1 Flujo Principal de Evaluación

1. **RECEPCIÓN DE SOLICITUD**
   - Entrada: Documento PDF en Base64 + metadata contextual
   - Validación de formato y tamaño
   - Identificación del tipo de documento (LOP, POLICY, etc.)

2. **ANÁLISIS ADAPTATIVO DEL DOCUMENTO**
   ```
   IF documento > 5MB OR páginas > 50:
      → Estrategia de procesamiento por chunks
   ELSE IF contiene imágenes/firmas:
      → Procesamiento visual con GPT-4o Vision + Gemini
   ELSE:
      → Procesamiento estándar con OCR
   ```

3. **EXTRACCIÓN DE INFORMACIÓN**
   - **Fase 1:** OCR y extracción de texto estructurado
   - **Fase 2:** Análisis visual para elementos gráficos
   - **Fase 3:** Identificación inteligente de páginas relevantes
   - **Fase 4:** Procesamiento paralelo de campos PMC

4. **SISTEMA DE VALIDACIÓN MULTINIVEL**

   ```javascript
   // Nivel 1: Evaluación Primaria
   response_1 = GPT-4o.evaluate(document, field)
   
   // Nivel 2: Validación Dual (si está habilitada)
   IF (dual_validation_enabled):
      response_2 = GPT-4o.validate(document, field)
      consensus = calculateAgreement(response_1, response_2)
      
   // Nivel 3: Validación Triple (para campos críticos)
   IF (triple_validation_enabled AND critical_field):
      response_3 = Claude.evaluate(document, field)
      IF disagreement:
         final = GPT-4o.arbitrate(response_1, response_2, response_3)
   ```

5. **NORMALIZACIÓN DE RESPUESTAS**
   - Fechas: Formato unificado MM-DD-YY
   - Booleanos: YES/NO (mayúsculas)
   - Números: Sin formato adicional
   - Texto: Limpieza y normalización

---

## 4. TIPOS DE CAMPOS PMC SOPORTADOS

| Tipo de Campo | Formato de Respuesta | Ejemplo |
|--------------|---------------------|---------|
| BOOLEAN | YES / NO | "YES" |
| DATE | MM-DD-YY | "07-22-25" |
| TEXT | String normalizado | "John Doe" |
| NUMBER | Número sin formato | "150000" |
| CURRENCY | Número con decimales | "1500.50" |
| JSON | Objeto estructurado | {"items": [...]} |

---

## 5. OPTIMIZACIONES ESPECIALES

### 5.1 Procesamiento de Documentos Grandes
- **Chunking inteligente:** División en segmentos de 180K tokens
- **Procesamiento paralelo:** Hasta 5 chunks simultáneos
- **Early exit:** Detención al encontrar respuesta con confianza > 0.85

### 5.2 Detección de Firmas
- **Análisis multipágina:** Escaneo secuencial con prioridad en últimas páginas
- **Visión dual:** GPT-4o Vision + Gemini para mayor precisión
- **Optimización LOP:** Análisis limitado a páginas clave para documentos LOP

### 5.3 Sistema de Caché
- **Caché de resultados:** 15 minutos por documento procesado
- **Caché de análisis visual:** Reutilización de detección de elementos gráficos
- **Rate limiting:** Control inteligente de llamadas a APIs

---

## 6. MANEJO DE ERRORES Y RESILIENCIA

### 6.1 Estrategia de Fallback
```
1. Intento con modelo principal (GPT-4o)
   ↓ [Error]
2. Reintento con backoff exponencial (3 intentos)
   ↓ [Error persistente]
3. Fallback a Claude Sonnet 4
   ↓ [Error]
4. Procesamiento local con OCR básico
   ↓ [Error crítico]
5. Respuesta NOT_FOUND con confianza 0.0
```

### 6.2 Códigos de Error
- `DOCUMENT_TOO_LARGE`: Documento excede 15MB
- `PROCESSING_TIMEOUT`: Timeout después de 8 minutos
- `INVALID_FORMAT`: Formato de PDF no soportado
- `API_RATE_LIMIT`: Límite de API alcanzado

---

## 7. MÉTRICAS DE RENDIMIENTO

### 7.1 Tiempos de Respuesta Promedio
- **Documento simple (< 10 páginas):** 3-5 segundos
- **Documento mediano (10-50 páginas):** 8-15 segundos  
- **Documento grande (> 50 páginas):** 20-45 segundos
- **Timeout máximo:** 8 minutos

### 7.2 Precisión por Tipo de Campo
- **Campos booleanos:** 98% precisión
- **Fechas:** 95% precisión
- **Números/Montos:** 97% precisión
- **Texto libre:** 92% precisión
- **Detección de firmas:** 94% precisión

---

## 8. ESTRUCTURA DE REQUEST/RESPONSE

### 8.1 Request (POST /api/underwriting/evaluate-claim)
```json
{
  "record_id": "CLM-2025-001",
  "document_name": "LOP.pdf",
  "file_data": "base64_encoded_pdf_content",
  "context": {
    "policy_number": "POL-123456",
    "claim_date": "01-15-25",
    "insured_name": "John Doe"
  }
}
```

### 8.2 Response
```json
{
  "record_id": "CLM-2025-001",
  "status": "completed",
  "results": {
    "LOP.pdf": [
      {
        "pmc_field": "has_signature",
        "response": "YES",
        "confidence": 0.95,
        "tokens_used": 1250,
        "reasoning": "Signature detected on page 3"
      }
    ]
  },
  "summary": {
    "fields_evaluated": 15,
    "fields_answered": 14,
    "avg_confidence": 0.92,
    "processing_time_ms": 4250
  }
}
```

---

## 9. CONSIDERACIONES DE SEGURIDAD

- **Encriptación:** TLS 1.3 para todas las comunicaciones
- **Autenticación:** API Keys con rotación periódica
- **Validación:** Sanitización estricta de inputs
- **Logs:** Auditoría completa sin exposición de datos sensibles
- **Compliance:** Cumplimiento con estándares HIPAA/PCI según configuración

---

## 10. INTEGRACIÓN Y DESPLIEGUE

### 10.1 Requisitos Mínimos
- **CPU:** 4 cores
- **RAM:** 8GB (16GB recomendado)
- **Almacenamiento:** 50GB SSD
- **Red:** 100 Mbps simétrico

### 10.2 Variables de Entorno Críticas
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
TRIPLE_VALIDATION=true
OPENAI_MODEL=gpt-4o
PORT=5011
```

### 10.3 Endpoints de Salud
- `GET /api/health` - Estado del servicio
- `GET /api/metrics` - Métricas de rendimiento
- `GET /api/ready` - Preparación para recibir requests

---

## 11. ROADMAP Y MEJORAS FUTURAS

1. **Q1 2025:** Integración con GPT-5 cuando esté disponible
2. **Q2 2025:** Soporte para documentos en múltiples idiomas
3. **Q3 2025:** Análisis predictivo de riesgos
4. **Q4 2025:** Dashboard de analytics en tiempo real

---

## 12. CONTACTO Y SOPORTE

Para consultas técnicas sobre la integración del sistema UWIA con la plataforma Claim Pay, el equipo de desarrollo está disponible para proporcionar soporte adicional y documentación específica según los requerimientos del proyecto.

---

*Documento generado: 09-02-2025*  
*Versión del Sistema: 2.0.0*  
*Última actualización: Normalización de respuestas booleanas a mayúsculas*