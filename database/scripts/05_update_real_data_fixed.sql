-- Script corregido para actualizar la base de datos con la configuración real
-- Archivo: 05_update_real_data_fixed.sql

-- Agregar columna pmc_field a la tabla document_prompts
ALTER TABLE document_prompts ADD COLUMN pmc_field VARCHAR(255) NOT NULL AFTER id;

-- Limpiar datos existentes para empezar fresh
DELETE FROM document_prompts WHERE document_name IN ('LOP.pdf', 'POLICY.pdf');

-- Insertar configuración real para LOP.pdf
INSERT INTO document_prompts (pmc_field, document_name, prompt_order, question, expected_type, active) VALUES
('LOP signed by HO', 'LOP.pdf', 1, 'Is the document signed by the homeowner? (YES/NO)', 'boolean', TRUE),
('LOP signed by Client', 'LOP.pdf', 2, 'Is the document signed by the provider? (YES/NO)', 'boolean', TRUE),
('LOP Date', 'LOP.pdf', 3, 'What is the date the document was signed?', 'date', TRUE),
('Mechanics Lien (New)', 'LOP.pdf', 4, 'Is there mechanics lien language in the document? (YES/NO)', 'boolean', TRUE);

-- Insertar configuración real para POLICY.pdf
INSERT INTO document_prompts (pmc_field, document_name, prompt_order, question, expected_type, active) VALUES
('Matching Insured name', 'POLICY.pdf', 1, 'Does the insured name from the document match %CMS insured%?', 'boolean', TRUE),
('Matching Insurance Company', 'POLICY.pdf', 2, 'Does the insurance company from the document matches %Insurance Company%?', 'boolean', TRUE),
('Policy Valid From', 'POLICY.pdf', 3, 'What is the policy validity starting date?', 'date', TRUE),
('Policy Valid To', 'POLICY.pdf', 4, 'What is the policy validity end date?', 'date', TRUE),
('Policy Number', 'POLICY.pdf', 5, 'What is the policy number?', 'text', TRUE),
('Policy Covers Cause of Loss (New)', 'POLICY.pdf', 6, 'Give me a list of the services covered by this policy document', 'text', TRUE),
('Match Address homeowner', 'POLICY.pdf', 7, 'What is the address of the homeowner? match with Insured from CMS', 'text', TRUE),
('Match Street homeowner', 'POLICY.pdf', 8, 'What is the street on the homeowner address? match with Insured from CMS', 'text', TRUE),
('Match City homeowner', 'POLICY.pdf', 9, 'What is the city on the homeowner address? match with Insured from CMS', 'text', TRUE),
('Match ZIP homeowner', 'POLICY.pdf', 10, 'What is the ZIP on the homeowner address? match with Insured from CMS', 'text', TRUE);

-- Verificar que los datos se insertaron correctamente
SELECT 'LOP.pdf prompts:' as info;
SELECT pmc_field, question, expected_type FROM document_prompts WHERE document_name = 'LOP.pdf' ORDER BY prompt_order;

SELECT 'POLICY.pdf prompts:' as info;
SELECT pmc_field, question, expected_type FROM document_prompts WHERE document_name = 'POLICY.pdf' ORDER BY prompt_order;
