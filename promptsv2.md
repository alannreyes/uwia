# Prompts v2 - Correcciones Database-First

## 🎯 Propósito
Este documento contiene las correcciones necesarias para los prompts de la base de datos `document_consolidado` para compensar la eliminación del código hardcodeado.

## 🔴 CRÍTICO - LOP.pdf (ID: 1)

### ❌ PROBLEMA ACTUAL
El prompt actual tiene instrucciones básicas de comparación pero falta lógica robusta que antes manejaba `recalculateMatches()`.

### ✅ SOLUCIÓN - Agregar al Final del Prompt Actual

```sql
UPDATE document_consolidado
SET question = CONCAT(question, '

CRITICAL COMPARISON LOGIC (for fields 12-18):
- Normalize both values before comparing: convert to lowercase, remove punctuation, spaces, and special characters
- For ZIP codes: compare only the 5-digit numbers, ignore formatting
- For dates: compare only the digits (MMDDYY), ignore separators and formatting
- For policy/claim numbers: compare alphanumeric characters only, ignore spaces and special formatting
- For addresses: normalize and allow for reasonable abbreviations (St/Street, Ave/Avenue, etc.)
- For names: allow for minor spelling variations and formatting differences

COMPARISON RULES:
12. onb_street_match: Compare extracted street with %insured_street% - normalize both, allow abbreviations
13. onb_zip_match: Compare extracted ZIP with %insured_zip% - match on 5 digits only
14. onb_address_match: Compare full address with %insured_address% - use state abbreviation only for state comparison
15. onb_city_match: Compare extracted city with %insured_city% - normalize both
16. onb_date_of_loss_match: Compare extracted date with %date_of_loss% - match on digits only (MMDDYY)
17. onb_policy_number_match: Compare extracted policy with %policy_number% - alphanumeric only
18. onb_claim_number_match: Compare extracted claim with %claim_number% - alphanumeric only

Return YES for matches (allowing reasonable variations), NO for clear differences.')
WHERE id = 1;
```

## 🔴 CRÍTICO - LOP.pdf Mechanics Lien Detection

### ❌ PROBLEMA ACTUAL
La detección de "mechanics_lien" es muy básica y antes era complementada por `detectMechanicsLien()`.

### ✅ SOLUCIÓN - Reemplazar la Instrucción del Campo 1

```sql
UPDATE document_consolidado
SET question = REPLACE(question,
  '1. mechanics_lien: Search for language related to liens, mechanics liens, lien rights, lien waivers, security interests, or statements about placing claims on property or funds. Return YES if found or NO if not found.',
  '1. mechanics_lien: THOROUGHLY search for ANY lien-related language including:
  - "mechanic''s lien", "mechanics lien", "mechanic lien"
  - "construction lien", "lien upon", "lien rights"
  - "security interest", "lien waiver", "lien law"
  - "letter of protection" combined with "lien"
  - Multiple occurrences of "lien" with "proceeds"
  - Any statement about placing claims on property or insurance proceeds
  Search the ENTIRE document carefully. Return YES if ANY lien language is found, NO only if completely absent.')
WHERE id = 1;
```

## 🟡 MODERADO - POLICY.pdf (ID: 2)

### ❌ PROBLEMA ACTUAL
Los campos de comparación no tienen lógica robusta de normalización que antes manejaba el código.

### ✅ SOLUCIÓN - Mejorar Campos 3, 4 y 7

```sql
UPDATE document_consolidado
SET question = REPLACE(question,
  '3. matching_insured_name: Extract the primary insured or policyholder full name and compare with %insured_name%. Return YES if they match or NO if different.',
  '3. matching_insured_name: Extract the primary insured/policyholder name. Normalize both names (ignore case, punctuation, common abbreviations like Jr/Junior, Co/Company). Compare with %insured_name%. Return YES if they represent the same person/entity, NO if clearly different.')
WHERE id = 2;

UPDATE document_consolidado
SET question = REPLACE(question,
  '4. matching_insured_company: Extract the insurance company name and compare with %insurance_company%. Return YES if they represent the same company or NO if different.',
  '4. matching_insured_company: Extract the insurance company/carrier name. Normalize both names (ignore case, punctuation, common abbreviations like Inc/Incorporated, LLC/Limited). Compare with %insurance_company%. Return YES if they represent the same insurance company, NO if clearly different.')
WHERE id = 2;

UPDATE document_consolidado
SET question = REPLACE(question,
  '7. policy_covers_dol: Compare %date_of_loss% with the policy effective dates from fields 1 and 2 above. Return YES if %date_of_loss% falls between policy_valid_from1 and policy_valid_to1. Return NO if the date is before policy_valid_from1 or after policy_valid_to1. Focus only on date ranges, ignore coverage details.',
  '7. policy_covers_dol: Extract dates from fields 1 and 2, then parse %date_of_loss%. Convert all to comparable format (MM-DD-YY). Check if %date_of_loss% falls between (inclusive) policy_valid_from1 and policy_valid_to1. Account for different date formats. Return YES if within range, NO if outside range.')
WHERE id = 2;
```

## 🟢 MENOR - Mejoras Generales

### ✅ ROOF.pdf - Agregar Nota Visual

```sql
UPDATE document_consolidado
SET question = CONCAT('NOTE: This document requires VISUAL analysis of tables, charts, and diagrams that may not appear in text extraction. ', question)
WHERE id = 7;
```

### ✅ ESTIMATE.pdf - Agregar Nota Visual

```sql
UPDATE document_consolidado
SET question = CONCAT('NOTE: This document requires VISUAL analysis of signature areas and approval sections. ', question)
WHERE id = 3;
```

### ✅ Todos los Prompts - Formato de Respuesta Estricto

```sql
-- Agregar nota sobre formato exacto a todos los prompts que no la tienen
UPDATE document_consolidado
SET question = CONCAT(question, '

IMPORTANT: Return responses in EXACTLY the specified format. Use semicolons as separators. Do not add explanations, notes, or additional text.')
WHERE question NOT LIKE '%EXACTLY%';
```

## 📋 Resumen de Cambios Necesarios

### 🔴 **CRÍTICOS (Deben aplicarse INMEDIATAMENTE)**
1. **LOP.pdf**: Agregar lógica robusta de comparación para campos 12-18
2. **LOP.pdf**: Mejorar detección exhaustiva de mechanics_lien
3. **POLICY.pdf**: Mejorar normalización de nombres y fechas

### 🟡 **MODERADOS (Recomendados)**
4. **Todos**: Agregar notas sobre análisis visual donde sea necesario
5. **Todos**: Reforzar formato de respuesta estricto

### 📊 **Validación**
Después de aplicar estos cambios:
- POLICY.pdf debería retornar respuestas correctas para matching_insured_name/company
- LOP.pdf debería detectar liens con mayor precisión
- Los campos *_match deberían comparar correctamente con normalización

## 🚀 Scripts SQL Completos

```sql
-- 1. LOP.pdf - Agregar lógica de comparación
UPDATE document_consolidado
SET question = CONCAT(question, '

CRITICAL COMPARISON LOGIC (for fields 12-18):
- Normalize both values before comparing: convert to lowercase, remove punctuation, spaces, and special characters
- For ZIP codes: compare only the 5-digit numbers, ignore formatting
- For dates: compare only the digits (MMDDYY), ignore separators and formatting
- For policy/claim numbers: compare alphanumeric characters only, ignore spaces and special formatting
- For addresses: normalize and allow for reasonable abbreviations (St/Street, Ave/Avenue, etc.)
- For names: allow for minor spelling variations and formatting differences

COMPARISON RULES:
12. onb_street_match: Compare extracted street with %insured_street% - normalize both, allow abbreviations
13. onb_zip_match: Compare extracted ZIP with %insured_zip% - match on 5 digits only
14. onb_address_match: Compare full address with %insured_address% - use state abbreviation only for state comparison
15. onb_city_match: Compare extracted city with %insured_city% - normalize both
16. onb_date_of_loss_match: Compare extracted date with %date_of_loss% - match on digits only (MMDDYY)
17. onb_policy_number_match: Compare extracted policy with %policy_number% - alphanumeric only
18. onb_claim_number_match: Compare extracted claim with %claim_number% - alphanumeric only

Return YES for matches (allowing reasonable variations), NO for clear differences.')
WHERE id = 1;

-- 2. LOP.pdf - Mejorar mechanics_lien
UPDATE document_consolidado
SET question = REPLACE(question,
  '1. mechanics_lien: Search for language related to liens, mechanics liens, lien rights, lien waivers, security interests, or statements about placing claims on property or funds. Return YES if found or NO if not found.',
  '1. mechanics_lien: THOROUGHLY search for ANY lien-related language including:
  - "mechanic''s lien", "mechanics lien", "mechanic lien"
  - "construction lien", "lien upon", "lien rights"
  - "security interest", "lien waiver", "lien law"
  - "letter of protection" combined with "lien"
  - Multiple occurrences of "lien" with "proceeds"
  - Any statement about placing claims on property or insurance proceeds
  Search the ENTIRE document carefully. Return YES if ANY lien language is found, NO only if completely absent.')
WHERE id = 1;

-- 3. POLICY.pdf - Mejorar comparaciones
UPDATE document_consolidado
SET question = REPLACE(question,
  '3. matching_insured_name: Extract the primary insured or policyholder full name and compare with %insured_name%. Return YES if they match or NO if different.',
  '3. matching_insured_name: Extract the primary insured/policyholder name. Normalize both names (ignore case, punctuation, common abbreviations like Jr/Junior, Co/Company). Compare with %insured_name%. Return YES if they represent the same person/entity, NO if clearly different.')
WHERE id = 2;

UPDATE document_consolidado
SET question = REPLACE(question,
  '4. matching_insured_company: Extract the insurance company name and compare with %insurance_company%. Return YES if they represent the same company or NO if different.',
  '4. matching_insured_company: Extract the insurance company/carrier name. Normalize both names (ignore case, punctuation, common abbreviations like Inc/Incorporated, LLC/Limited). Compare with %insurance_company%. Return YES if they represent the same insurance company, NO if clearly different.')
WHERE id = 2;

UPDATE document_consolidado
SET question = REPLACE(question,
  '7. policy_covers_dol: Compare %date_of_loss% with the policy effective dates from fields 1 and 2 above. Return YES if %date_of_loss% falls between policy_valid_from1 and policy_valid_to1. Return NO if the date is before policy_valid_from1 or after policy_valid_to1. Focus only on date ranges, ignore coverage details.',
  '7. policy_covers_dol: Extract dates from fields 1 and 2, then parse %date_of_loss%. Convert all to comparable format (MM-DD-YY). Check if %date_of_loss% falls between (inclusive) policy_valid_from1 and policy_valid_to1. Account for different date formats. Return YES if within range, NO if outside range.')
WHERE id = 2;
```