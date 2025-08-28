-- Use the database
USE axioma;

-- Table for underwriting claims
CREATE TABLE IF NOT EXISTS uw_claims (
    id INT AUTO_INCREMENT PRIMARY KEY,
    claim_reference VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'pending',
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_claim_reference (claim_reference),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for documents associated with claims
CREATE TABLE IF NOT EXISTS uw_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    claim_id INT NOT NULL,
    filename VARCHAR(500) NOT NULL,
    document_type VARCHAR(100),
    file_size INT,
    mime_type VARCHAR(100),
    extracted_text LONGTEXT,
    extraction_status VARCHAR(50) DEFAULT 'pending',
    extraction_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES uw_claims(id) ON DELETE CASCADE,
    INDEX idx_claim_id (claim_id),
    INDEX idx_document_type (document_type),
    INDEX idx_extraction_status (extraction_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for AI evaluations
CREATE TABLE IF NOT EXISTS uw_evaluations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_id INT NOT NULL,
    prompt TEXT NOT NULL,
    expected_type ENUM('boolean', 'date', 'text', 'number', 'json') NOT NULL,
    additional_context TEXT,
    response TEXT,
    confidence DECIMAL(5,4),
    validation_response TEXT,
    validation_confidence DECIMAL(5,4),
    final_confidence DECIMAL(5,4),
    openai_metadata JSON,
    processing_time_ms INT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES uw_documents(id) ON DELETE CASCADE,
    INDEX idx_document_id (document_id),
    INDEX idx_expected_type (expected_type),
    INDEX idx_final_confidence (final_confidence),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for audit log
CREATE TABLE IF NOT EXISTS uw_audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT NOT NULL,
    action VARCHAR(50) NOT NULL,
    user_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    changes JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;