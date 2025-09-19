-- Actualizar el prompt de matching_insured_company para manejar variables vacías
UPDATE document_consolidado
SET question = REPLACE(
    question,
    '4. matching_insured_company: Extract the insurance company name and compare with %insurance_company%, dont look for an exact match. Return YES if they represent the same company or NO if different.',
    '4. matching_insured_company: Extract the insurance company name from the policy. If %insurance_company% is provided, compare them and return YES if they represent the same company or NO if different. If %insurance_company% is empty or not provided, return the extracted insurance company name instead.'
),
updated_at = NOW()
WHERE document_name = 'POLICY.pdf'
AND active = true;

-- Verificar el cambio
SELECT document_name, SUBSTRING(question, POSITION('matching_insured_company' IN question), 300) as matching_field
FROM document_consolidado
WHERE document_name = 'POLICY.pdf';