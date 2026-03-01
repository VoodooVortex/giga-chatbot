-- Migration: Fix embedding dimensions for OpenRouter
-- OpenRouter text-embedding-3-small produces 1536 dimensions
-- Previous migration used 768 dimensions (for Google text-embedding-004)
BEGIN;

-- Drop the existing HNSW index (depends on vector dimension)
DROP INDEX IF EXISTS rag.idx_embeddings_vector;

-- Clear existing embeddings (they have wrong dimensions)
-- This is necessary because we can't cast vector(768) to vector(1536)
TRUNCATE TABLE rag.embeddings;

-- Alter the column to use 1536 dimensions
ALTER TABLE rag.embeddings
ALTER COLUMN re_embedding TYPE vector (1536);

-- Recreate the HNSW index for similarity search
CREATE INDEX idx_embeddings_vector ON rag.embeddings USING hnsw (re_embedding vector_cosine_ops);

-- Add comment documenting the dimension size
COMMENT ON COLUMN rag.embeddings.re_embedding IS 'Vector embedding (1536 dimensions for OpenRouter text-embedding-3-small)';

COMMIT;