-- ENHANCED SIGNATURE DETECTION PROMPTS
-- Optimized for "407 Restoration CA LLC" provider LOP documents
-- Based on analysis showing clear signatures not being detected

-- ====================================================================
-- ENHANCED CLIENT SIGNATURE DETECTION
-- ====================================================================

-- Backup current prompt
INSERT INTO prompts_backup (pmc_field, old_question, backup_date)
SELECT pmc_field, question, NOW() 
FROM prompts_table 
WHERE pmc_field = 'lop_signed_by_client1';

-- Enhanced prompt with explicit visual cues and fallback detection
UPDATE prompts_table 
SET question = 'Look carefully for ANY handwritten signature, mark, or initial in the "Client 1 Signature", "Client Signature", or any field labeled for CLIENT/CUSTOMER signatures. 

WHAT TO LOOK FOR:
- Handwritten cursive signatures (like "Priscilla Chavez")
- Printed names written by hand  
- Initials or abbreviated signatures
- X marks or simple signature marks
- Any pen/pencil marks in signature fields

VISUAL CLUES:
- Look for signature lines (horizontal lines for signing)
- Areas with labels containing "Client", "Customer", "Insured", "Signature"
- Handwritten text that differs from printed text
- Dark ink marks that appear to be made by hand

Answer YES if you see ANY handwritten mark in client signature areas, even if it''s unclear or partially visible. Answer NO only if signature areas appear completely blank.',
    updated_at = NOW()
WHERE pmc_field = 'lop_signed_by_client1';

-- ====================================================================
-- ENHANCED SERVICE PROVIDER SIGNATURE DETECTION  
-- ====================================================================

-- Backup current prompt
INSERT INTO prompts_backup (pmc_field, old_question, backup_date)
SELECT pmc_field, question, NOW() 
FROM prompts_table 
WHERE pmc_field = 'lop_signed_by_ho1';

-- Enhanced prompt with explicit visual cues and fallback detection
UPDATE prompts_table 
SET question = 'Look carefully for ANY handwritten signature, mark, or initial in the "Service Provider Representative", "Provider Signature", "Contractor Signature", or any field labeled for PROVIDER/CONTRACTOR signatures.

WHAT TO LOOK FOR:
- Handwritten cursive signatures (like "Felipe R Moreno")
- Printed names written by hand
- Initials or abbreviated signatures  
- X marks or simple signature marks
- Any pen/pencil marks in signature fields

VISUAL CLUES:
- Look for signature lines (horizontal lines for signing)
- Areas with labels containing "Provider", "Contractor", "Representative", "Company", "Signature"
- Handwritten text that differs from printed text
- Dark ink marks that appear to be made by hand

Answer YES if you see ANY handwritten mark in provider/contractor signature areas, even if it''s unclear or partially visible. Answer NO only if signature areas appear completely blank.',
    updated_at = NOW()
WHERE pmc_field = 'lop_signed_by_ho1';

-- ====================================================================
-- VERIFICATION
-- ====================================================================
SELECT 'ENHANCED SIGNATURE PROMPTS APPLIED:' as status;
SELECT pmc_field, updated_at
FROM prompts_table 
WHERE pmc_field IN ('lop_signed_by_client1', 'lop_signed_by_ho1')
ORDER BY pmc_field;