-- Simplificar el prompt de ROOF.pdf para que extraiga el área total más efectivamente
-- El problema: el prompt actual es demasiado específico y busca cálculos complejos
-- cuando el documento ya muestra claramente "Total roof area: 2250 sqft"

UPDATE document_consolidado
SET question = 'Find the total roof area in square feet from this roofing report. Look for phrases like "Total roof area", "total area", or area measurements followed by "sqft", "square feet", or "sq ft". Return only the numeric value as an integer (e.g., 2250) without units, commas, or decimal points. If no roof area is found, return NOT_FOUND.',
    updated_at = NOW()
WHERE document_name = 'ROOF.pdf'
AND active = true;

-- Verificar el cambio
SELECT document_name,
       SUBSTRING(question, 1, 150) as prompt_inicio,
       LENGTH(question) as prompt_length
FROM document_consolidado
WHERE document_name = 'ROOF.pdf';