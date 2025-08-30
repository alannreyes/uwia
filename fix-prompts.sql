-- FIXES CONSERVADORES PARA PROMPTS ESPECÍFICOS
-- Backup y actualización segura - NO AFECTA otros campos

-- ====================================================================
-- PRIORIDAD 1: FIX CRÍTICO - onb_date_of_loss_match
-- Problema: No reconoce "06-22-25" vs "2025-06-22" como misma fecha
-- ====================================================================

-- Backup del prompt actual
INSERT INTO prompts_backup (pmc_field, old_question, backup_date)
SELECT pmc_field, question, NOW() 
FROM prompts_table 
WHERE pmc_field = 'onb_date_of_loss_match';

-- Update con manejo mejorado de años cortos/largos
UPDATE prompts_table 
SET question = 'Compare the date of loss found in this document with %date_of_loss%. Treat the dates as the same if the month, day, and year numbers match, even if the separators or year length differ. For year comparison, treat short years like ''25'' and full years like ''2025'' as equivalent when they represent the same year (e.g., ''25'' = ''2025''). Ignore differences in formatting (MM-DD-YY vs YYYY-MM-DD) and only focus on whether the numeric values for month, day, and year represent the exact same date. Answer YES if they match, otherwise answer NO.',
    updated_at = NOW()
WHERE pmc_field = 'onb_date_of_loss_match';

-- ====================================================================
-- PRIORIDAD 2: FIX MODERADO - lop_signed_by_client1  
-- Problema: No detecta firma sin nombre asociado
-- ====================================================================

-- Backup del prompt actual
INSERT INTO prompts_backup (pmc_field, old_question, backup_date)
SELECT pmc_field, question, NOW() 
FROM prompts_table 
WHERE pmc_field = 'lop_signed_by_client1';

-- Update con menor dependencia de nombres asociados
UPDATE prompts_table 
SET question = 'Look for any handwritten signature, initials, or mark in areas designated for the SERVICE PROVIDER, CONTRACTOR, COMPANY REPRESENTATIVE, or VENDOR. Search near labels like "Provider Signature", "Contractor Signature", "Company Representative", "Vendor Signature", or similar business/provider signature areas. Answer YES if you can visually identify any handwritten signature or mark in these provider areas, even if no printed name appears next to the signature line. Focus on the presence of the handwritten mark itself, not whether it has an associated printed name. Answer NO only if these provider areas appear completely blank or unsigned.',
    updated_at = NOW()
WHERE pmc_field = 'lop_signed_by_client1';

-- ====================================================================
-- VERIFICACIÓN DE CAMBIOS
-- ====================================================================
SELECT 'UPDATED PROMPTS:' as status;
SELECT pmc_field, LEFT(question, 100) as question_preview, updated_at
FROM prompts_table 
WHERE pmc_field IN ('onb_date_of_loss_match', 'lop_signed_by_client1')
ORDER BY pmc_field;