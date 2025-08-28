-- Script para corregir prompt confuso de firma del cliente
-- Archivo: 07_fix_client_signature_prompt.sql
-- Problema: Campo pide firma de "Client" pero prompt pregunta por "Provider"

-- ANTES: "Is the document signed by the provider? (YES/NO)"
-- DESPUÉS: Prompt correcto para firma del cliente

UPDATE document_prompts 
SET question = 'Is this document signed by the client/customer/homeowner? Look for signatures, signature lines, electronic signatures, or any handwritten signature indicating the document has been signed by the service recipient or policyholder. (YES/NO)'
WHERE pmc_field = 'LOP signed by Client' AND document_name = 'LOP.pdf';

-- Verificar el cambio
SELECT 'PROMPT ACTUALIZADO:' as status;
SELECT pmc_field, document_name, question 
FROM document_prompts 
WHERE pmc_field = 'LOP signed by Client' AND document_name = 'LOP.pdf';

-- Mostrar todos los prompts relacionados con firmas para verificar consistencia
SELECT 'TODOS LOS PROMPTS DE FIRMA:' as status;
SELECT pmc_field, document_name, question 
FROM document_prompts 
WHERE question LIKE '%sign%' 
ORDER BY document_name, pmc_field;