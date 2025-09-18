CREATE TABLE IF NOT EXISTS claim_evaluations_gemini (
  id INT AUTO_INCREMENT PRIMARY KEY,
  claim_reference VARCHAR(255) NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  prompt_consolidado_id INT NOT NULL,
  question TEXT NOT NULL,
  response TEXT NULL,
  confidence DECIMAL(5,4) NULL,
  processing_time_ms INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_claim_ref (claim_reference),
  INDEX idx_doc_name (document_name),
  INDEX idx_created_at (created_at)
);
