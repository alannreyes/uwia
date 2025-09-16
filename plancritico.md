# Plan crítico de estabilización RAG PDF (Sept 2025)

Objetivo: Resolver fallos críticos en el pipeline de PDFs que afectan el RAG y la generación de embeddings. Prioridad operacional: 1) Splitting de POLICY.pdf gigante en chunks manejables; 2) Robustez contra embeddings vacíos; 3) OCR efectivo para PDFs escaneados con texto ínfimo.

## 1) POLICY.pdf: splitting cuando solo hay 1 página y >1M chars

- Ubicación: `src/modules/underwriting/chunking/services/enhanced-pdf-processor.service.ts` método `processInBatches()`.
- Problema: `extractTextByPages()` puede devolver 1 "página" con texto completo (~19M chars). Guardar un solo chunk rompe la etapa de embeddings (time, size y truncación en modelo).
- Solución:
  - Si `textPages.length === 1 && textPages[0].content.length > 1_000_000`, dividir el contenido en segmentos de 8192 caracteres (8KB aprox) ANTES de `createChunksFromPages` y del almacenamiento en `ChunkStorageService`.
  - Guardar `pageStart=1` y `pageEnd=1` en cada sub-chunk para trazabilidad.
  - Loggear: tamaño original, cantidad de sub-chunks creados, y progreso de almacenamiento.
- Aceptación:
  - POLICY.pdf (19M chars) genera miles de chunks de ~8KB, sesión `ready` con `totalChunks > 0`, sin errores de memoria.
  - RAG pipeline consume embeddings progresivamente sin timeouts.

## 2) Validación de chunks vacíos y embeddings

- Ubicaciones:
  - `src/modules/underwriting/chunking/services/semantic-chunking.service.ts` método `convertPdfChunksToSemanticChunks(...)`.
  - `src/modules/underwriting/chunking/services/vector-storage.service.ts` método `storeEmbeddings(...)`.
- Problema: chunks vacíos o casi vacíos causan errores/rendimiento pobre en la etapa de embeddings.
- Solución:
  - Filtrar contenido con `content.trim().length > 10` antes de segmentar o embeddear.
  - Si no pasa el umbral, loggear `warn` y omitir el chunk (no fallar el pipeline).
  - Contar y reportar cuántos chunks se omitieron.
- Aceptación:
  - Los pipelines avanzan aunque existan páginas/chunks vacíos.
  - Logs reflejan skips sin detener el proceso.

## 3) OCR fallback para PDFs escaneados (ROOF.pdf, WEATHER.pdf)

- Ubicación: `src/modules/underwriting/services/pdf-toolkit.service.ts` método `extractText(...)`.
- Problema: PDFs que no tienen capa de texto (p.ej., 4–6 chars) necesitan OCR.
- Solución:
  - Flujo escalonado:
    1. Intentar `pdf-parse`. Si `< 50` chars, continuar.
    2. Intentar `pdfjs-dist` avanzado (mismo loader ESM + `disableWorker: true`, `standardFontDataUrl`). Si `< 50` chars, continuar.
    3. OCR con `tesseract.js` limitado a N páginas (configurable: primeras 2-5) con idioma `eng` por defecto y throttling básico.
  - Colocar flags/env: `OCR_ENABLED=true`, `OCR_MAX_PAGES=3`, `OCR_LANGS=eng`, `OCR_TIMEOUT_MS=180000`.
  - Agregar logs de conteo de caracteres y fuente del resultado (parse/js/ocr).
- Aceptación:
  - ROOF.pdf y WEATHER.pdf devuelven > 100 chars tras OCR si hay contenido legible.
  - Si OCR falla, retornar el mejor esfuerzo sin romper pipeline.

## Riesgos y mitigaciones

- Volumen de chunks (POLICY): controlar el batch size y backpressure en `ChunkStorageService` para no saturar memoria. Confirmar que `maxParallel` se respeta.
- Costo embeddings: agregar guardrails para longitudes máximas por chunk (8KB ~ seguro) y skips por vacíos.
- OCR performance: limitar páginas, agregar timeouts, y permitir desactivar por env en despliegues costo-sensibles.

## Orden de implementación (prioridad)

1. Splitting 8KB para caso 1 pág > 1M chars en `EnhancedPdfProcessorService.processInBatches()`.
2. Validación/skip de chunks vacíos en `SemanticChunkingService` y `VectorStorageService`.
3. OCR fallback (pdfjs avanzado → tesseract) en `PdfToolkitService.extractText()`.

## Pruebas sugeridas

- Incluir fixtures: POLICY.pdf grande; ROOF.pdf y WEATHER.pdf escaneados.
- Verificar: tiempos, cantidad de chunks, skips, tamaño promedio, uso de memoria y que RAG retorne resultados sin 500/timeout.
