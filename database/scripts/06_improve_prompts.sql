-- Script para mejorar prompts ambiguos y corregir errores
-- Archivo: 06_improve_prompts.sql

-- Actualizar prompts de LOP.pdf
UPDATE document_prompts 
SET question = 'What is the date when the document was signed? If there are multiple signature dates, provide the most recent one. Format: MM-DD-YY'
WHERE pmc_field = 'LOP Date' AND document_name = 'LOP.pdf';

UPDATE document_prompts 
SET question = 'Does this document contain mechanics lien language, lien waiver clauses, or any mention of lien rights? Look for terms like ''lien'', ''lien waiver'', ''lien rights'', or ''mechanic''s lien''. (YES/NO)'
WHERE pmc_field = 'Mechanics Lien (New)' AND document_name = 'LOP.pdf';

-- Actualizar prompts de POLICY.pdf
UPDATE document_prompts 
SET question = 'Does the insured name in this policy document match ''%CMS insured%''? Consider name variations, middle initials, and different name orders as matches. (YES/NO)'
WHERE pmc_field = 'Matching Insured name' AND document_name = 'POLICY.pdf';

UPDATE document_prompts 
SET question = 'Does the insurance company name in this policy document match ''%Insurance Company%''? Consider abbreviations and slight variations as matches. (YES/NO)'
WHERE pmc_field = 'Matching Insurance Company' AND document_name = 'POLICY.pdf';

UPDATE document_prompts 
SET question = 'What is the policy number? Provide the complete policy number exactly as shown in the document, including any letters, numbers, and dashes.'
WHERE pmc_field = 'Policy Number' AND document_name = 'POLICY.pdf';

UPDATE document_prompts 
SET question = 'Does this policy cover the type of loss/damage specified: ''%type_of_job%''? Look specifically for coverage of wind damage, storm damage, water damage, fire, etc. Answer YES if covered, NO if excluded or not mentioned.'
WHERE pmc_field = 'Policy Covers Cause of Loss (New)' AND document_name = 'POLICY.pdf';

UPDATE document_prompts 
SET question = 'Does the property address in this policy match ''%insured_address%''? Consider slight formatting differences as matches. (YES/NO)'
WHERE pmc_field = 'Match Address homeowner' AND document_name = 'POLICY.pdf';

UPDATE document_prompts 
SET question = 'Does the street address in this policy match ''%insured_street%''? (YES/NO)'
WHERE pmc_field = 'Match Street homeowner' AND document_name = 'POLICY.pdf';

UPDATE document_prompts 
SET question = 'Does the city in this policy match ''%insured_city%''? (YES/NO)'
WHERE pmc_field = 'Match City homeowner' AND document_name = 'POLICY.pdf';

UPDATE document_prompts 
SET question = 'Does the ZIP code in this policy match ''%insured_zip%''? Consider both 5-digit and 9-digit formats as matches. (YES/NO)'
WHERE pmc_field = 'Match ZIP homeowner' AND document_name = 'POLICY.pdf';

-- Verificar cambios
SELECT 'PROMPTS ACTUALIZADOS:' as status;
SELECT pmc_field, question FROM document_prompts WHERE document_name IN ('LOP.pdf', 'POLICY.pdf') ORDER BY document_name, prompt_order;