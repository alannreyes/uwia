# Ejemplo de uso del endpoint batch desde n8n

## Endpoint
```
POST http://automate_uwia:5015/api/underwriting/evaluate-claim-batch
```

## Headers
```json
{
  "Content-Type": "application/json"
}
```

## Body
```json
{
  "record_id": "406324",
  "carpeta_id": "15tgwSI87yzODYZ8qHN_rpS50PryN23S6",
  "insured_name": "JOSE ESQUIVEL and JOSEFINA ESQUIVEL",
  "insurance_company": "INTERINSURANCE EXCHANGE OF THE AUTOMOBILE CLUB",
  "insured_address": "525 DE ANZA WAY, OXNARD, CA 93033-6566",
  "insured_street": "525 DE ANZA WAY",
  "insured_city": "OXNARD",
  "insured_zip": "93033-6566",
  "type_of_job": "wind damage",
  "documents": [
    {
      "document_name": "COC",
      "file_data": "JVBERi0xLjQKJeLjz9MKNCAwIG9iaiA8PAovTGVuZ3RoIDEzNTkKPj4K..."
    },
    {
      "document_name": "ESTIMATE",
      "file_data": "JVBERi0xLjQKJeLjz9MKNCAwIG9iaiA8PAovTGVuZ3RoIDEzNTkKPj4K..."
    },
    {
      "document_name": "LOP",
      "file_data": "JVBERi0xLjQKJeLjz9MKNCAwIG9iaiA8PAovTGVuZ3RoIDEzNTkKPj4K..."
    },
    {
      "document_name": "POLICY",
      "file_data": "JVBERi0xLjQKJeLjz9MKNCAwIG9iaiA8PAovTGVuZ3RoIDEzNTkKPj4K..."
    },
    {
      "document_name": "ROOF",
      "file_data": "JVBERi0xLjQKJeLjz9MKNCAwIG9iaiA8PAovTGVuZ3RoIDEzNTkKPj4K..."
    },
    {
      "document_name": "WEATHER",
      "file_data": "JVBERi0xLjQKJeLjz9MKNCAwIG9iaiA8PAovTGVuZ3RoIDEzNTkKPj4K..."
    },
    {
      "document_name": "MOLD",
      "file_data": "JVBERi0xLjQKJeLjz9MKNCAwIG9iaiA8PAovTGVuZ3RoIDEzNTkKPj4K..."
    }
  ]
}
```

## Modificación necesaria en n8n

En lugar de hacer múltiples requests paralelos, necesitas:

1. Después de "Filtrar y Ordenar", agregar un nodo "Code" que consolide todos los documentos
2. El nodo debe crear el array de documentos con sus base64
3. Hacer UN SOLO request HTTP al endpoint batch

### Código para el nodo de consolidación:
```javascript
// Consolidar todos los documentos en un array
const allDocuments = $input.all();
const documents = [];

// Obtener datos del contexto
const contextData = $('Validar Entrada').all()[0].json;

// Crear array de documentos
for (const item of allDocuments) {
  const doc = item.json;
  
  // Descargar el archivo y convertir a base64
  // NOTA: Necesitarás ajustar esto según cómo obtengas el archivo
  documents.push({
    document_name: doc.document_name || doc.name.replace('.pdf', ''),
    file_data: doc.file_data || doc.data // Base64 del archivo
  });
}

// Crear el payload para el batch
return [{
  json: {
    record_id: contextData.record_id,
    carpeta_id: contextData.carpeta_id,
    documents: documents,
    // Incluir todo el contexto
    ...contextData.context
  }
}];
```

## Ventajas del batch endpoint:
1. **Un solo request** en lugar de 7
2. **Sin timeouts** por requests múltiples
3. **Procesamiento más eficiente**
4. **Respuesta consolidada** lista para PMC