-- Script para manejar documentos no estándar
-- Archivo: 08_handle_non_standard_docs.sql
-- Problema: Sistema rechaza documentos con nombres no configurados como LOP_old

-- OPCIÓN 1: Agregar configuración para variantes de documentos
-- Esto permite procesar LOP_old como si fuera LOP

-- Copiar todos los prompts de LOP.pdf para LOP_old.pdf
INSERT INTO document_prompts (pmc_field, document_name, prompt_order, question, expected_type, requires_pdf)
SELECT pmc_field, 'LOP_old.pdf', prompt_order, question, expected_type, requires_pdf
FROM document_prompts 
WHERE document_name = 'LOP.pdf';

-- También para otras variantes comunes
INSERT INTO document_prompts (pmc_field, document_name, prompt_order, question, expected_type, requires_pdf)
SELECT pmc_field, 'LOP OLD.pdf', prompt_order, question, expected_type, requires_pdf
FROM document_prompts 
WHERE document_name = 'LOP.pdf'
AND NOT EXISTS (
    SELECT 1 FROM document_prompts dp2 
    WHERE dp2.document_name = 'LOP OLD.pdf' 
    AND dp2.pmc_field = document_prompts.pmc_field
);

-- Verificar documentos configurados
SELECT 'DOCUMENTOS CONFIGURADOS:' as status;
SELECT DISTINCT document_name, COUNT(*) as num_prompts 
FROM document_prompts 
GROUP BY document_name 
ORDER BY document_name;

-- NOTA: Para PDFs escaneados grandes (>10MB sin texto extraíble):
-- 1. Necesitan procesarse con Vision API
-- 2. Considerar reducir tamaño/calidad antes de procesar
-- 3. Verificar que no estén protegidos/encriptados