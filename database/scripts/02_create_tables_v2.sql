-- Use the database
USE axioma;

-- Tabla 1: Configuración de preguntas por documento
CREATE TABLE IF NOT EXISTS document_prompts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_name VARCHAR(255) NOT NULL,
    prompt_order INT NOT NULL,
    question TEXT NOT NULL,
    expected_type VARCHAR(20) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_doc_order (document_name, prompt_order),
    INDEX idx_document_name (document_name),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla 2: Resultados de evaluaciones
CREATE TABLE IF NOT EXISTS claim_evaluations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    claim_reference VARCHAR(255) NOT NULL,
    document_name VARCHAR(255) NOT NULL,
    prompt_id INT NOT NULL,
    question TEXT NOT NULL,
    response TEXT,
    confidence DECIMAL(5,4),
    validation_response TEXT,
    validation_confidence DECIMAL(5,4),
    final_confidence DECIMAL(5,4),
    processing_time_ms INT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prompt_id) REFERENCES document_prompts(id),
    INDEX idx_claim_reference (claim_reference),
    INDEX idx_document_name (document_name),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;