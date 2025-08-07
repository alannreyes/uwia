# Procesamiento de Documento Individual

## Comportamiento Actualizado

Ahora cada request procesa **SOLO** el documento que se envía, no todos los de la base de datos.

## Ejemplos de Requests

### Request 1: Procesar COC.pdf
```json
POST /api/underwriting/evaluate-claim-multipart
{
  "record_id": "406324",
  "carpeta_id": "15tgwSI87yzODYZ8qHN_rpS50PryN23S6",
  "document_name": "COC",
  "context": {...},
  "file": [archivo COC.pdf]
}
```

**Respuesta**: Solo las preguntas de COC.pdf

### Request 2: Procesar LOP.pdf
```json
POST /api/underwriting/evaluate-claim-multipart
{
  "record_id": "406324",
  "carpeta_id": "15tgwSI87yzODYZ8qHN_rpS50PryN23S6",
  "document_name": "LOP",
  "context": {...},
  "file": [archivo LOP.pdf]
}
```

**Respuesta**: Solo las preguntas de LOP.pdf

## Ventajas

1. **Más eficiente**: Cada request procesa solo lo necesario
2. **Sin duplicación**: No se procesan todos los documentos en cada request
3. **Paralelo real**: n8n puede enviar 7 requests paralelos sin problemas
4. **Tiempos reducidos**: De 50+ minutos a ~1-2 minutos por documento

## Flujo en n8n

1. n8n envía 7 requests paralelos (uno por documento)
2. Cada request lleva su PDF específico
3. La API procesa solo las preguntas de ese documento
4. n8n consolida las 7 respuestas
5. Envía el resultado final a PMC

## Comparación

### Antes (problema):
```
Request COC → Procesa COC + ESTIMATE + LOP + POLICY + ROOF + WEATHER + MOLD
Request LOP → Procesa COC + ESTIMATE + LOP + POLICY + ROOF + WEATHER + MOLD
... 7 veces = 49 procesamientos = timeout
```

### Ahora (solución):
```
Request COC → Procesa solo COC
Request LOP → Procesa solo LOP
Request POLICY → Procesa solo POLICY
... 7 requests = 7 procesamientos = rápido
```