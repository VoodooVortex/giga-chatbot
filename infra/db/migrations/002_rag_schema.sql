-- ============================================================================
-- RAG Schema Migration
-- ============================================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create rag schema
CREATE SCHEMA IF NOT EXISTS rag;

-- Embeddings Table
CREATE TABLE rag.embeddings (
    re_id BIGSERIAL PRIMARY KEY,
    re_source_table VARCHAR(100) NOT NULL,
    re_source_pk VARCHAR(100) NOT NULL,
    re_content TEXT NOT NULL,
    re_embedding VECTOR(1536), -- OpenAI text-embedding-3-small dimension
    re_source_updated_at TIMESTAMPTZ,
    re_embedded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    re_created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Unique constraint on source
    UNIQUE(re_source_table, re_source_pk)
);

-- Indexes for embeddings
CREATE INDEX embeddings_source_idx ON rag.embeddings(re_source_table, re_source_pk);
CREATE INDEX embeddings_table_idx ON rag.embeddings(re_source_table);

-- HNSW index for fast vector similarity search
CREATE INDEX embeddings_embedding_idx ON rag.embeddings 
    USING hnsw (re_embedding vector_cosine_ops);

-- Partial index for embeddings that need updating
CREATE INDEX embeddings_needs_update_idx ON rag.embeddings(re_source_table, re_source_pk)
    WHERE re_source_updated_at > re_embedded_at;

-- ============================================================================
-- RAG Update Notify Function and Trigger
-- ============================================================================

-- Function to notify on data changes for RAG
CREATE OR REPLACE FUNCTION public.notify_rag_update()
RETURNS TRIGGER AS $$
DECLARE
    payload JSON;
    pk_column TEXT;
    pk_value TEXT;
BEGIN
    -- Determine the primary key column name
    -- This handles different table structures
    IF TG_TABLE_NAME = 'devices' THEN
        pk_column := 'de_id';
    ELSIF TG_TABLE_NAME = 'device_childs' THEN
        pk_column := 'dec_id';
    ELSIF TG_TABLE_NAME = 'categories' THEN
        pk_column := 'ca_id';
    ELSIF TG_TABLE_NAME = 'borrow_return_tickets' THEN
        pk_column := 'brt_id';
    ELSIF TG_TABLE_NAME = 'ticket_issues' THEN
        pk_column := 'ti_id';
    ELSE
        pk_column := 'id';
    END IF;
    
    -- Get primary key value
    EXECUTE format('SELECT ($1).%I::text', pk_column) INTO pk_value USING NEW;
    
    -- Build payload
    payload := json_build_object(
        'table', TG_TABLE_NAME,
        'pk', pk_value,
        'action', TG_OP
    );
    
    -- Send notification
    PERFORM pg_notify('rag_update', payload::text);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function for DELETE operations (uses OLD instead of NEW)
CREATE OR REPLACE FUNCTION public.notify_rag_update_delete()
RETURNS TRIGGER AS $$
DECLARE
    payload JSON;
    pk_column TEXT;
    pk_value TEXT;
BEGIN
    -- Determine the primary key column name
    IF TG_TABLE_NAME = 'devices' THEN
        pk_column := 'de_id';
    ELSIF TG_TABLE_NAME = 'device_childs' THEN
        pk_column := 'dec_id';
    ELSIF TG_TABLE_NAME = 'categories' THEN
        pk_column := 'ca_id';
    ELSIF TG_TABLE_NAME = 'borrow_return_tickets' THEN
        pk_column := 'brt_id';
    ELSIF TG_TABLE_NAME = 'ticket_issues' THEN
        pk_column := 'ti_id';
    ELSE
        pk_column := 'id';
    END IF;
    
    -- Get primary key value from OLD record
    EXECUTE format('SELECT ($1).%I::text', pk_column) INTO pk_value USING OLD;
    
    -- Build payload
    payload := json_build_object(
        'table', TG_TABLE_NAME,
        'pk', pk_value,
        'action', 'DELETE'
    );
    
    -- Send notification
    PERFORM pg_notify('rag_update', payload::text);
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE rag.embeddings IS 'Vector embeddings for RAG retrieval';
COMMENT ON COLUMN rag.embeddings.re_source_table IS 'Source table name (e.g., devices, ticket_issues)';
COMMENT ON COLUMN rag.embeddings.re_source_pk IS 'Primary key of the source record';
COMMENT ON COLUMN rag.embeddings.re_content IS 'Text content that was embedded';
COMMENT ON COLUMN rag.embeddings.re_embedding IS 'Vector embedding (1536 dimensions for OpenAI)';
COMMENT ON COLUMN rag.embeddings.re_source_updated_at IS 'When the source record was last updated';
COMMENT ON COLUMN rag.embeddings.re_embedded_at IS 'When this embedding was created/updated';

COMMENT ON FUNCTION public.notify_rag_update() IS 'Trigger function to notify on data changes for RAG updates';
COMMENT ON FUNCTION public.notify_rag_update_delete() IS 'Trigger function for DELETE operations on RAG-tracked tables';