-- Actualización inteligente del prompt para manejar variables faltantes
-- Cuando la variable está vacía, extrae y retorna el valor encontrado

UPDATE document_consolidado
SET question = 'Extract the following 7 data points from this insurance policy document: 1. policy_valid_from1: Find the policy start or effective date when coverage begins. Convert to MM-DD-YY format. Return the earliest date if multiple exist or NOT_FOUND. 2. policy_valid_to1: Find the policy expiration or end date when coverage ends. Convert to MM-DD-YY format. Return the latest date if multiple exist or NOT_FOUND. 3. matching_insured_name: Extract the primary insured or policyholder full name. If %insured_name% is provided, compare them (dont look for an exact match) and return YES if they match or NO if different. If %insured_name% is empty, return the extracted name. 4. matching_insured_company: Extract the insurance company name. If %insurance_company% is provided, compare them (dont look for an exact match) and return YES if they represent the same company or NO if different. If %insurance_company% is empty, return the extracted company name. 5. policy_covers_type_job: Return YES if the policy explicitly covers wind, storm, weather damage. Return NO only if %type_of_job% is explicitly excluded. 6. policy_exclusion: List only the specific %cause_of_loss% exclusions found in the policy. If multiple exclusions exist, separate with commas. Return NOT_FOUND if no wind exclusions exist. 7. policy_covers_dol: Compare %date_of_loss% with the policy effective dates from fields 1 and 2 above. Return YES if %date_of_loss% falls between policy_valid_from1 and policy_valid_to1. Return NO if the date is before policy_valid_from1 or after policy_valid_to1. Focus only on date ranges, ignore coverage details. Return EXACTLY in this format with semicolons as separators: policy_valid_from1;policy_valid_to1;matching_insured_name;matching_insured_company;policy_covers_type_job;policy_exclusion;policy_covers_dol',
updated_at = NOW()
WHERE document_name = 'POLICY.pdf'
AND active = true;

-- Verificar el cambio
SELECT document_name,
       SUBSTRING(question, 1, 100) as inicio,
       LENGTH(question) as longitud_total
FROM document_consolidado
WHERE document_name = 'POLICY.pdf';