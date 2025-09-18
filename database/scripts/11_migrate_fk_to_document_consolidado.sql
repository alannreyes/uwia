-- Migración: Alinear FK de claim_evaluations con tabla document_consolidado
-- Contexto: En producción, DOCUMENT_PROMPTS_TABLE_NAME=document_consolidado
-- Objetivo: Hacer que claim_evaluations.prompt_id → document_consolidado(id)

-- 1) Detectar y eliminar la FK actual que apunta a document_prompts
SET @schema = DATABASE();
SET @table = 'claim_evaluations';
SET @column = 'prompt_id';

SELECT CONSTRAINT_NAME
INTO @fk_name
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = @table
  AND COLUMN_NAME = @column
  AND REFERENCED_TABLE_NAME = 'document_prompts'
LIMIT 1;

SET @drop_sql = IF(
  @fk_name IS NOT NULL,
  CONCAT('ALTER TABLE ', @table, ' DROP FOREIGN KEY ', @fk_name, ';'),
  'SELECT 1;'
);

PREPARE stmt FROM @drop_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Crear (si no existe ya) una FK hacia document_consolidado(id)
-- Verificar si ya existe alguna FK apuntando a document_consolidado
SELECT CONSTRAINT_NAME
INTO @fk_consol
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = @table
  AND COLUMN_NAME = @column
  AND REFERENCED_TABLE_NAME = 'document_consolidado'
LIMIT 1;

SET @add_sql = IF(
  @fk_consol IS NULL,
  'ALTER TABLE claim_evaluations ADD CONSTRAINT fk_claim_eval_prompt_consolidado FOREIGN KEY (prompt_id) REFERENCES document_consolidado(id);',
  'SELECT 1;'
);

PREPARE stmt2 FROM @add_sql;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- 3) (Opcional) Asegurar índice sobre prompt_id para performance
ALTER TABLE claim_evaluations ADD INDEX IF NOT EXISTS idx_claim_eval_prompt_id (prompt_id);
