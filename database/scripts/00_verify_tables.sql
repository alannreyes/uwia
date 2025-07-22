-- Script para verificar si las tablas ya existen
USE axioma;

-- Verificar qué tablas del proyecto UWIA existen
SELECT TABLE_NAME, TABLE_COMMENT 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = 'axioma' 
AND TABLE_NAME IN ('uw_claims', 'uw_documents', 'uw_evaluations', 'uw_audit_log');

-- Contar registros si las tablas existen
SELECT 'uw_claims' as tabla, COUNT(*) as registros FROM uw_claims
UNION ALL
SELECT 'uw_documents', COUNT(*) FROM uw_documents  
UNION ALL
SELECT 'uw_evaluations', COUNT(*) FROM uw_evaluations
UNION ALL
SELECT 'uw_audit_log', COUNT(*) FROM uw_audit_log;