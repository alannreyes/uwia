# Plan Maestro de Mejoras para el Sistema de Procesamiento de Documentos

## 1. Visión General y Objetivos

El objetivo de este plan es reestructurar el sistema de procesamiento de documentos para que sea más robusto, resiliente y eficiente. Se busca eliminar fallos catastróficos, manejar una mayor variedad de PDFs (escaneados, multi-página, muy grandes) y unificar la lógica de negocio para facilitar el mantenimiento y la extensibilidad.

## 2. Arquitectura Propuesta: Un Pipeline Unificado

Se propone abandonar la arquitectura de dos flujos (`evaluateClaim` y `processLargeFileSynchronously`) y adoptar un único pipeline de procesamiento por etapas. Cada etapa se enfoca en una tarea específica y pasa el resultado a la siguiente.

El nuevo flujo será orquestado por un `ProcessingOrchestratorService` y seguirá estos pasos:

1.  **Recepción y Clasificación Inicial**:  
    ✅ Estructura de sesión y clasificación inicial implementada en el pipeline actual.
    *   Recibir el archivo.
    *   Determinar su tipo (PDF, imagen) y tamaño.
    *   Crear una sesión de procesamiento única en la base de datos para tracking.

2.  **Etapa de Extracción de Contenido (Multi-paso)**:
    *   **Paso 1: Extracción Rápida de Texto**. ✅ Ya implementado con `pdf-parse`.
    *   **Paso 2: Extracción Avanzada de Texto**. ✅ Ya implementado con `pdfjs-dist` (legacy, worker config corregido).
    *   **Paso 3: Detección y Aplicación de OCR**. 🔄 En progreso: OCR service y fallback planificado, integración pendiente.
        *   Convertir las páginas del PDF a imágenes (PNG/JPEG).
        *   Utilizar un servicio de OCR (como Tesseract.js o una API externa como Google Vision) para extraer texto de cada imagen.
        *   Ensamblar el texto extraído en un formato coherente.
    *   **Paso 4: Análisis con Modelos de Visión (Gemini, GPT-4 Vision)**. ✅ GeminiService creado, lógica de decisión por tamaño implementada en orquestador.
        *   Si el archivo es **menor de 20MB**, se usará el método de **datos en línea** de Gemini (enviar el buffer directamente).
        *   Si el archivo es **mayor de 20MB y hasta 50MB**, se usará la **File API** de Gemini (subir, esperar estado ACTIVE, luego consultar por URI).
        *   El orquestador decidirá el método automáticamente según el tamaño.
        *   Si ambos métodos fallan o el archivo supera 50MB, se intentará dividir el PDF en partes menores y procesar por lotes, o se usará fallback a OCR/visión por página.
### 3.5. `GeminiService` (Nuevo)
*   **Propósito**: Encapsular la lógica de integración con la API de Gemini, soportando ambos métodos (inline y File API).
*   **Implementación**: El servicio expone dos métodos:
    *   `processDocumentInline(buffer, prompt)`: para archivos <20MB.
    *   `processDocumentWithFileAPI(buffer, prompt)`: para archivos 20–50MB.
    *   El orquestador decide cuál usar y maneja los estados de procesamiento.
*   **Compatibilidad**: Usa la variable de entorno `GEMINI_API_KEY` ya existente.
*   **Fallback**: Si Gemini falla, el pipeline sigue con OCR o procesamiento tradicional.

3.  **Etapa de "Chunking" Inteligente**:
    *   Para documentos que superen un umbral de tamaño (configurable, ej. 20MB o 100 páginas), el contenido extraído (sea texto o imágenes) se dividirá en "chunks" o fragmentos.
    *   El chunking no se basará en un tamaño fijo de caracteres, sino en la estructura del documento (párrafos, secciones, páginas). Esto mejora la coherencia del contexto para los modelos de lenguaje.

4.  **Etapa de Análisis y Estructuración (RAG)**:
    *   Los chunks se procesan para generar "embeddings" y se almacenan en una base de datos vectorial (si aplica).
    *   Se ejecuta el pipeline de RAG (Retrieval-Augmented Generation) usando los prompts definidos para extraer la información solicitada. El sistema buscará los chunks más relevantes y los inyectará en el prompt final al LLM.

5.  **Etapa de Validación y Formateo**:
    *   La salida del LLM se valida contra un esquema esperado.
    *   Se realizan reintentos con estrategias de corrección si la validación falla.
    *   Se formatea la salida final en el formato JSON requerido.

## 3. Mejoras Específicas y Nuevos Componentes

### 3.1. `OcrService` 🔄 En progreso
*   **Propósito**: Centralizar la lógica de OCR.
*   **Implementación**: Crear un nuevo servicio `OcrService` que se integre con una librería como `Tesseract.js` o una API externa. Deberá ser capaz de procesar un buffer de imagen y devolver el texto extraído.
*   **Configuración**: Habilitar/deshabilitar el OCR y configurar el proveedor a través de variables de entorno (`OCR_ENABLED`, `OCR_PROVIDER`).

### 3.2. Refactorización de `PdfParserService` y `PdfToolkitService` ✅
*   **Propósito**: Eliminar redundancia.
*   **Acción**: Fusionar la funcionalidad de `PdfToolkitService` dentro de `PdfParserService`. El `PdfParserService` se convertirá en el único responsable de la extracción de texto y la conversión a imágenes, simplificando el código y evitando la duplicación de lógica.

### 3.3. `ProcessingOrchestratorService` ✅ Creado y conectado a GeminiService.
*   **Propósito**: Orquestar el nuevo pipeline unificado.
*   **Implementación**: Este servicio contendrá la lógica principal del pipeline descrito en la sección 2. Llamará a los demás servicios (`PdfParserService`, `OcrService`, `ModernRagService`, etc.) en la secuencia correcta.

### 3.4. Gestión de Memoria y Grandes Archivos 🔄 En progreso: chunking y splitting avanzado planificado, parte básica ya implementada.
*   **Problema**: El procesamiento de archivos de más de 100MB en memoria puede causar crashes.
*   **Solución**:
    1.  **Streaming**: Para la conversión de PDF a imágenes, se deben usar librerías que soporten streaming para no cargar el archivo completo en memoria.
    2.  **Procesamiento por Páginas**: En la etapa de OCR y Visión, las páginas se procesarán una por una (o en pequeños lotes), liberando la memoria de la imagen anterior antes de cargar la siguiente.
    3.  **Almacenamiento Temporal**: Para archivos muy grandes, las imágenes de las páginas se pueden guardar temporalmente en disco en lugar de mantenerlas en memoria.

## 4. Plan de Implementación por Fases

*   **Fase 1: Refactorización y Unificación**
    1.  ✅ Crear el `ProcessingOrchestratorService` con la estructura básica del pipeline.
    2.  ✅ Fusionar `PdfToolkitService` en `PdfParserService`.
    3.  🔄 Adaptar el `UnderwritingController` para que utilice el nuevo orquestador (pendiente endpoint v2).
    4.  ✅ Mantener la lógica existente funcionando dentro del nuevo pipeline para no romper la funcionalidad actual.

*   **Fase 2: Integración de OCR**
    1.  🔄 Desarrollar el `OcrService` (en progreso).
    2.  🔄 Integrar la etapa de OCR en el `ProcessingOrchestratorService` (planificado).
    3.  🔄 Añadir la lógica para detectar cuándo usar OCR (planificado).
    4.  ✅ Integrar la etapa de Gemini Vision (inline o File API) como fallback antes de OCR, según tamaño.
    5.  🔄 Probar con documentos escaneados y complejos (pendiente).

*   **Fase 3: Optimización de Grandes Archivos y Modelos de Visión**
    1.  🔄 Implementar las mejoras de gestión de memoria (streaming, procesamiento por páginas) (parcialmente hecho, splitting avanzado pendiente).
    2.  ✅ Integrar la etapa de "Análisis con Modelos de Visión" (GeminiService) como el último recurso del pipeline de extracción, con lógica de decisión por tamaño.
    3.  🔄 Realizar pruebas de estrés con archivos de diferentes tamaños (pendiente).

## 5. Variables de Entorno Sugeridas

Para controlar el nuevo comportamiento, se sugiere añadir las siguientes variables de entorno:

```
# Habilita o deshabilita el pipeline de OCR
OCR_ENABLED=true

# Define el proveedor de OCR (ej. 'tesseract', 'google-vision')
OCR_PROVIDER=tesseract

# Habilita o deshabilita el uso de modelos de visión como fallback
VISION_ANALYSIS_ENABLED=true

# Umbral de tamaño en MB para activar el modo de "procesamiento de archivo grande" (chunking, etc.)
LARGE_FILE_THRESHOLD_MB=20

# Número máximo de páginas a enviar a un modelo de visión en una sola llamada
VISION_MAX_PAGES=5

# Clave de API para Gemini (ya usada en el sistema)
GEMINI_API_KEY=tu_api_key
```

## Resumen de la mejora principal

La nueva versión implementa un pipeline unificado y robusto para procesar cualquier PDF (nativo, escaneado, grande o pequeño), integrando extracción de texto avanzada, fallback automático a OCR, chunking inteligente y uso de Gemini/OpenAI Vision según el caso. Ahora, si el PDF supera el límite del método inline, el sistema utiliza automáticamente el método File API de Gemini para procesar archivos grandes. Si los modelos de IA fallan, retorna el texto extraído. La mejora esperada es máxima resiliencia: ningún PDF queda sin procesar, se minimizan errores, y se aprovechan al máximo las capacidades de IA y OCR, con logs claros y manejo automático de casos límite.
