-- Script para agregar configuración de INVOICES.pdf
-- Archivo: 09_add_invoices_configuration.sql

-- Insertar configuración para INVOICES.pdf basada en los patrones existentes
INSERT INTO document_prompts (pmc_field, document_name, prompt_order, question, expected_type, active) VALUES
('Invoice Number', 'INVOICES.pdf', 1, 'What is the invoice number from this document?', 'text', TRUE),
('Invoice Date', 'INVOICES.pdf', 2, 'What is the date of this invoice?', 'date', TRUE),
('Invoice Amount', 'INVOICES.pdf', 3, 'What is the total amount of this invoice?', 'text', TRUE),
('Invoice Company', 'INVOICES.pdf', 4, 'What company or business issued this invoice?', 'text', TRUE),
('Invoice Services', 'INVOICES.pdf', 5, 'What services or items are listed in this invoice?', 'text', TRUE),
('Invoice Status', 'INVOICES.pdf', 6, 'Is this invoice marked as paid or unpaid? (PAID/UNPAID/UNKNOWN)', 'text', TRUE);

-- Verificar que se insertó correctamente
SELECT 'INVOICES.pdf prompts added:' as info;
SELECT pmc_field, question, expected_type FROM document_prompts WHERE document_name = 'INVOICES.pdf' ORDER BY prompt_order;
