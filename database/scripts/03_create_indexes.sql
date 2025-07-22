-- Use the database
USE axioma;

-- Additional indexes for performance optimization

-- Composite indexes for common queries
CREATE INDEX idx_claim_status_date ON uw_claims(status, created_at);
CREATE INDEX idx_doc_claim_type ON uw_documents(claim_id, document_type);
CREATE INDEX idx_eval_doc_type ON uw_evaluations(document_id, expected_type);

-- Full text search indexes (if needed)
-- ALTER TABLE uw_documents ADD FULLTEXT(extracted_text);

-- Index for JSON fields (MySQL 5.7+)
-- CREATE INDEX idx_claims_metadata ON uw_claims((CAST(metadata->>'$.category' AS CHAR(50))));
-- CREATE INDEX idx_openai_model ON uw_evaluations((CAST(openai_metadata->>'$.primary_model' AS CHAR(50))));