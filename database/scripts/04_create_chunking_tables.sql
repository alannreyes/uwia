-- Tabla para sesiones de procesamiento
CREATE TABLE pdf_processing_sessions (
  id VARCHAR(36) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL,
  total_chunks INT DEFAULT 0,
  processed_chunks INT DEFAULT 0,
  status ENUM('processing', 'ready', 'expired', 'error') DEFAULT 'processing',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL 24 HOUR),
  metadata JSON,
  INDEX idx_status_expires (status, expires_at)
);

-- Tabla para chunks con búsqueda optimizada
CREATE TABLE pdf_chunks (
  id VARCHAR(50) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  chunk_index INT NOT NULL,
  content LONGTEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  chunk_size INT NOT NULL,
  page_start INT,
  page_end INT,
  keywords JSON,
  summary TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (session_id) REFERENCES pdf_processing_sessions(id) ON DELETE CASCADE,
  INDEX idx_session_chunks (session_id, chunk_index),
  FULLTEXT INDEX ft_content (content),
  FULLTEXT INDEX ft_summary (summary)
);
