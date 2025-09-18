-- Agregar configuración para INVOICES.pdf en document_consolidado

INSERT INTO document_consolidado (
  document_name,
  question,
  expected_type,
  prompt_order,
  field_names,
  expected_fields_count,
  active,
  created_at,
  updated_at,
  pmc_field
) VALUES (
  'INVOICES.pdf',
  'Extract invoice information from this document. Look for: 1. invoice_total: Find the total amount due or invoice total. Return the numeric amount only (e.g., 1500.00) or NOT_FOUND. 2. invoice_date: Find the invoice date. Convert to MM-DD-YY format or NOT_FOUND. 3. vendor_name: Extract the vendor or company name issuing the invoice or NOT_FOUND. Return EXACTLY in this format with semicolons as separators: invoice_total;invoice_date;vendor_name',
  'text',
  1,
  '["invoice_total", "invoice_date", "vendor_name"]',
  3,
  true,
  NOW(),
  NOW(),
  'invoices_responses'
);

-- Verificar que se insertó correctamente
SELECT * FROM document_consolidado WHERE document_name = 'INVOICES.pdf';