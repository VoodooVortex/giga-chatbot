-- ============================================================================
-- RAG Schema Migration (Updated for Orbis-Track)
-- ============================================================================
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create rag schema
CREATE SCHEMA IF NOT EXISTS rag;

-- Embeddings Table (Google text-embedding-004 = 768 dimensions)
CREATE TABLE rag.embeddings (
    re_id BIGSERIAL PRIMARY KEY,
    re_source_table VARCHAR(100) NOT NULL,
    re_source_pk VARCHAR(100) NOT NULL,
    re_content TEXT NOT NULL,
    re_embedding VECTOR (768), -- Google text-embedding-004 dimension
    re_source_updated_at TIMESTAMPTZ,
    re_embedded_at TIMESTAMPTZ DEFAULT NOW () NOT NULL,
    re_created_at TIMESTAMPTZ DEFAULT NOW () NOT NULL,
    -- Unique constraint on source
    UNIQUE (re_source_table, re_source_pk)
);

-- Indexes for embeddings
CREATE INDEX embeddings_source_idx ON rag.embeddings (re_source_table, re_source_pk);

CREATE INDEX embeddings_table_idx ON rag.embeddings (re_source_table);

-- HNSW index for fast vector similarity search
CREATE INDEX embeddings_embedding_idx ON rag.embeddings USING hnsw (re_embedding vector_cosine_ops);

-- Partial index for embeddings that need updating
CREATE INDEX embeddings_needs_update_idx ON rag.embeddings (re_source_table, re_source_pk)
WHERE
    re_source_updated_at > re_embedded_at;

-- ============================================================================
-- NOTE
-- ============================================================================
-- RAG NOTIFY trigger function is maintained in Orbis-Track repo
-- (docker/db-init/002-rag-triggers.sql) to avoid duplication/conflicts.
-- This migration only provisions rag schema/table/indexes.
-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE rag.embeddings IS 'Vector embeddings for RAG retrieval (Google text-embedding-004, 768 dimensions)';

COMMENT ON COLUMN rag.embeddings.re_source_table IS 'Source table name (e.g., devices, ticket_issues)';

COMMENT ON COLUMN rag.embeddings.re_source_pk IS 'Primary key of the source record';

COMMENT ON COLUMN rag.embeddings.re_content IS 'Text content that was embedded';

COMMENT ON COLUMN rag.embeddings.re_embedding IS 'Vector embedding (768 dimensions for Google text-embedding-004)';

COMMENT ON COLUMN rag.embeddings.re_source_updated_at IS 'When the source record was last updated';

COMMENT ON COLUMN rag.embeddings.re_embedded_at IS 'When this embedding was created/updated';