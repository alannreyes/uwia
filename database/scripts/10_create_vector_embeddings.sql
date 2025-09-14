-- Cambia 'tu_base_de_datos' por el nombre real de tu base de datos antes de ejecutar
USE axioma;
-- Migration: Add Vector Embeddings Support
-- Date: 2025-09-13
-- Description: Create tables for modern RAG with text-embedding-3-large

-- 1. Create document_embeddings table
CREATE TABLE `document_embeddings` (
  `id` varchar(36) NOT NULL,
  `session_id` varchar(36) NOT NULL,
  `chunk_id` varchar(100) NOT NULL,
  `chunk_index` int NOT NULL,
  `content` longtext NOT NULL,
  `content_hash` varchar(64) NOT NULL,
  `embedding` json NOT NULL,
  `embedding_model` varchar(50) NOT NULL DEFAULT 'text-embedding-3-large',
  `embedding_dimensions` int NOT NULL DEFAULT 3072,
  `semantic_type` enum('header','content','table','list','conclusion','signature','footer','metadata') NOT NULL DEFAULT 'content',
  `importance` enum('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  `token_count` int NOT NULL,
  `character_count` int NOT NULL,
  `page_start` int DEFAULT NULL,
  `page_end` int DEFAULT NULL,
  `position_start` int NOT NULL,
  `position_end` int NOT NULL,
  `has_numbers` tinyint(1) NOT NULL DEFAULT 0,
  `has_dates` tinyint(1) NOT NULL DEFAULT 0,
  `has_names` tinyint(1) NOT NULL DEFAULT 0,
  `has_addresses` tinyint(1) NOT NULL DEFAULT 0,
  `has_monetary_values` tinyint(1) NOT NULL DEFAULT 0,
  `has_legal_terms` tinyint(1) NOT NULL DEFAULT 0,
  `entities` json DEFAULT NULL,
  `keywords` json DEFAULT NULL,
  `similar_chunks` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_document_embeddings_session` (`session_id`),
  KEY `idx_document_embeddings_chunk` (`chunk_id`),
  KEY `idx_document_embeddings_semantic_type` (`semantic_type`),
  KEY `idx_document_embeddings_importance` (`importance`),
  KEY `idx_content_hash` (`content_hash`),
  KEY `idx_token_count` (`token_count`),
  KEY `idx_has_dates` (`has_dates`),
  KEY `idx_has_names` (`has_names`),
  KEY `idx_has_monetary_values` (`has_monetary_values`),
  CONSTRAINT `fk_document_embeddings_session` FOREIGN KEY (`session_id`) REFERENCES `pdf_processing_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. Create vector_queries table
CREATE TABLE `vector_queries` (
  `id` varchar(36) NOT NULL,
  `session_id` varchar(36) NOT NULL,
  `query_text` text NOT NULL,
  `query_hash` varchar(64) NOT NULL,
  `query_embedding` json NOT NULL,
  `embedding_model` varchar(50) NOT NULL DEFAULT 'text-embedding-3-large',
  `similarity_threshold` decimal(4,3) NOT NULL DEFAULT 0.700,
  `max_results` int NOT NULL DEFAULT 5,
  `search_method` enum('semantic','hybrid','keyword') NOT NULL DEFAULT 'hybrid',
  `results_found` int NOT NULL,
  `processing_time_ms` int NOT NULL,
  `total_chunks_searched` int NOT NULL,
  `retrieved_chunks` json NOT NULL,
  `generated_answer` longtext DEFAULT NULL,
  `answer_confidence` decimal(4,3) DEFAULT NULL,
  `llm_model_used` varchar(50) DEFAULT NULL,
  `total_tokens_used` int DEFAULT NULL,
  `cache_hit` tinyint(1) NOT NULL DEFAULT 0,
  `error_message` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_vector_queries_session` (`session_id`),
  KEY `idx_vector_queries_created` (`created_at`),
  KEY `idx_query_hash` (`query_hash`),
  KEY `idx_search_method` (`search_method`),
  KEY `idx_cache_hit` (`cache_hit`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Add full-text search support for content (hybrid search)
ALTER TABLE `document_embeddings` ADD FULLTEXT KEY `ft_content` (`content`);

-- 4. Create optimized view for similarity searches
CREATE VIEW `v_embedding_search` AS
SELECT 
  e.id,
  e.session_id,
  e.chunk_id,
  e.chunk_index,
  e.content,
  e.embedding,
  e.semantic_type,
  e.importance,
  e.token_count,
  e.has_dates,
  e.has_names,
  e.has_monetary_values,
  e.entities,
  e.keywords,
  s.filename as document_name,
  s.status as session_status
FROM document_embeddings e
JOIN pdf_processing_sessions s ON e.session_id = s.id
WHERE s.status = 'ready';

-- 5. Create indexes for performance optimization
CREATE INDEX `idx_embedding_importance_semantic` ON `document_embeddings` (`importance`, `semantic_type`);
CREATE INDEX `idx_embedding_content_type` ON `document_embeddings` (`semantic_type`, `has_dates`, `has_names`);

-- 6. Add embedding statistics table for monitoring
CREATE TABLE `embedding_statistics` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `date` date NOT NULL,
  `total_embeddings_generated` int NOT NULL DEFAULT 0,
  `total_tokens_used` bigint NOT NULL DEFAULT 0,
  `total_queries_processed` int NOT NULL DEFAULT 0,
  `average_similarity_threshold` decimal(4,3) DEFAULT NULL,
  `average_processing_time_ms` int DEFAULT NULL,
  `cache_hit_rate` decimal(4,3) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_embedding_stats_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Insert initial statistics record
INSERT INTO `embedding_statistics` (`date`, `total_embeddings_generated`, `total_tokens_used`, `total_queries_processed`)
VALUES (CURDATE(), 0, 0, 0)
ON DUPLICATE KEY UPDATE
  `total_embeddings_generated` = `total_embeddings_generated`,
  `total_tokens_used` = `total_tokens_used`,
  `total_queries_processed` = `total_queries_processed`;

-- 8. Create stored procedure for similarity search (optional optimization)
DELIMITER //
CREATE PROCEDURE GetSimilarChunks(
  IN p_session_id VARCHAR(36),
  IN p_semantic_types VARCHAR(500),
  IN p_importance_levels VARCHAR(100),
  IN p_has_entities BOOLEAN,
  IN p_limit INT
)
BEGIN
  DECLARE sql_query TEXT;
  
  SET sql_query = 'SELECT 
    id, chunk_id, content, embedding, semantic_type, importance, 
    token_count, entities, keywords
  FROM document_embeddings 
  WHERE session_id = ?';
  
  IF p_semantic_types IS NOT NULL THEN
    SET sql_query = CONCAT(sql_query, ' AND FIND_IN_SET(semantic_type, ?)');
  END IF;
  
  IF p_importance_levels IS NOT NULL THEN
    SET sql_query = CONCAT(sql_query, ' AND FIND_IN_SET(importance, ?)');
  END IF;
  
  IF p_has_entities = TRUE THEN
    SET sql_query = CONCAT(sql_query, ' AND entities IS NOT NULL');
  END IF;
  
  SET sql_query = CONCAT(sql_query, ' ORDER BY importance DESC, token_count DESC LIMIT ?');
  
  SET @sql = sql_query;
  PREPARE stmt FROM @sql;
  
  IF p_semantic_types IS NOT NULL AND p_importance_levels IS NOT NULL THEN
    EXECUTE stmt USING p_session_id, p_semantic_types, p_importance_levels, p_limit;
  ELSEIF p_semantic_types IS NOT NULL THEN
    EXECUTE stmt USING p_session_id, p_semantic_types, p_limit;
  ELSEIF p_importance_levels IS NOT NULL THEN
    EXECUTE stmt USING p_session_id, p_importance_levels, p_limit;
  ELSE
    EXECUTE stmt USING p_session_id, p_limit;
  END IF;
  
  DEALLOCATE PREPARE stmt;
END //
DELIMITER ;

-- 9. Add comments for documentation
ALTER TABLE `document_embeddings` COMMENT = 'Stores vector embeddings for semantic search using text-embedding-3-large';
ALTER TABLE `vector_queries` COMMENT = 'Logs vector queries and their results for analytics and caching';
ALTER TABLE `embedding_statistics` COMMENT = 'Daily statistics for embedding usage and performance monitoring';

-- Verify the migration
SELECT 
  TABLE_NAME,
  TABLE_ROWS,
  CREATE_TIME
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME IN ('document_embeddings', 'vector_queries', 'embedding_statistics');
