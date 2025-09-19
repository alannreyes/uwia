# Debug para Variable insurance_company

## Problema Identificado
El campo `matching_insured_company` en POLICY.pdf siempre retorna "NO" porque la variable `%insurance_company%` está llegando vacía al prompt.

## Análisis
1. **Prompt actual en DB:**
   ```
   4. matching_insured_company: Extract the insurance company name and compare with %insurance_company%
   ```

2. **Cuando la variable está vacía, el prompt queda:**
   ```
   4. matching_insured_company: Extract the insurance company name and compare with
   ```

3. **El sistema compara con una cadena vacía, por eso siempre retorna NO**

## Soluciones Implementadas

### 1. Script SQL para mejorar el prompt
Archivo: `fix-matching-insured-company.sql`
- Modifica el prompt para manejar variables vacías inteligentemente
- Si la variable está vacía, extrae y retorna el valor encontrado en lugar de comparar

### 2. Servicio de manejo de variables mejorado
Archivo: `src/modules/underwriting/services/variable-handler.service.ts`
- Detecta variables vacías en prompts de comparación
- Modifica dinámicamente el prompt cuando falta la variable
- Puede extraer automáticamente valores del documento

### 3. Verificación de variables en el request

**Para verificar que las variables se estén enviando:**

```bash
# En los logs, buscar:
grep "VAR-DEBUG" logs.txt | grep insurance_company
```

**Formato esperado del request:**
```json
{
  "record_id": "xxx",
  "carpeta_id": "yyy",
  "document_name": "POLICY",
  "context": {
    "insurance_company": "State Farm",  // <-- Esta variable debe estar presente
    "insured_name": "John Doe",
    // ... otras variables
  }
}
```

## Recomendación Final

**Opción 1 (Rápida):** Ejecuta el script SQL para actualizar el prompt
```bash
mysql -u root -p uwia < fix-matching-insured-company.sql
```

**Opción 2 (Completa):** Asegúrate de que el frontend/cliente esté enviando la variable `insurance_company` en el contexto del request.

## Testing
Para probar si funciona:
1. Envía un request con `insurance_company` en el contexto
2. Verifica que el campo 4 retorne "YES" si coincide o el nombre extraído si la variable está vacía