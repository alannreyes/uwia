-- Use the database
USE axioma;

-- Configuración para LOP DOCUMENT.pdf
INSERT INTO document_prompts (document_name, prompt_order, question, expected_type) VALUES
('LOP DOCUMENT.pdf', 1, 'Is the document signed by the homeowner? (YES/NO)', 'boolean'),
('LOP DOCUMENT.pdf', 2, 'Is the document signed by the provider? (YES/NO)', 'boolean'),
('LOP DOCUMENT.pdf', 3, 'What is the date the document was signed?', 'date'),
('LOP DOCUMENT.pdf', 4, 'Is there mechanics lien language in the document? (YES/NO)', 'boolean');

-- Configuración para POLICY DOCUMENT.pdf
INSERT INTO document_prompts (document_name, prompt_order, question, expected_type) VALUES
('POLICY DOCUMENT.pdf', 1, 'Does the insured name from the document match the expected insured name?', 'boolean'),
('POLICY DOCUMENT.pdf', 2, 'Does the insurance company from the document match the expected company?', 'boolean'),
('POLICY DOCUMENT.pdf', 3, 'What is the policy validity starting date?', 'date'),
('POLICY DOCUMENT.pdf', 4, 'What is the policy validity end date?', 'date'),
('POLICY DOCUMENT.pdf', 5, 'What is the policy number?', 'text'),
('POLICY DOCUMENT.pdf', 6, 'Give me a list of the services covered by this policy document', 'text');