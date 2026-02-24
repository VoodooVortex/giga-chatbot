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
    re_embedding VECTOR(768), -- Google text-embedding-004 dimension
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
    pk_value TEXT;
    relevant_columns TEXT[];
    should_notify BOOLEAN := false;
    col_name TEXT;
BEGIN
    -- Define relevant columns for each table
    IF TG_TABLE_NAME = 'devices' THEN
        relevant_columns := ARRAY['de_name', 'de_description', 'de_location', 'de_serial_number', 'de_max_borrow_days'];
        pk_value := NEW.de_id::text;
    ELSIF TG_TABLE_NAME = 'device_childs' THEN
        relevant_columns := ARRAY['dec_asset_code', 'dec_serial_number', 'dec_status', 'dec_has_serial_number'];
        pk_value := NEW.dec_id::text;
    ELSIF TG_TABLE_NAME = 'categories' THEN
        relevant_columns := ARRAY['ca_name'];
        pk_value := NEW.ca_id::text;
    ELSIF TG_TABLE_NAME = 'borrow_return_tickets' THEN
        relevant_columns := ARRAY['brt_status', 'brt_user', 'brt_usage_location', 'brt_borrow_purpose', 
                                   'brt_start_date', 'brt_end_date', 'brt_reject_reason'];
        pk_value := NEW.brt_id::text;
    ELSIF TG_TABLE_NAME = 'ticket_issues' THEN
        relevant_columns := ARRAY['ti_title', 'ti_description', 'ti_status', 'ti_result', 
                                   'ti_damaged_reason', 'ti_resolved_note'];
        pk_value := NEW.ti_id::text;
    ELSE
        -- Default: notify on any change
        relevant_columns := ARRAY['*'];
        pk_value := 'unknown';
    END IF;
    
    -- For INSERT, always notify
    IF TG_OP = 'INSERT' THEN
        should_notify := true;
    -- For UPDATE, check if relevant columns changed
    ELSIF TG_OP = 'UPDATE' THEN
        FOREACH col_name IN ARRAY relevant_columns
        LOOP
            -- Check if column exists in the record and has changed
            IF EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = TG_TABLE_NAME 
                       AND column_name = col_name
                       AND table_schema = TG_TABLE_SCHEMA) THEN
                IF OLD IS DISTINCT FROM NEW THEN
                    -- Simplified check: if any column changed, notify
                    -- More precise check can be added if needed
                    should_notify := true;
                    EXIT;
                END IF;
            END IF;
        END LOOP;
    END IF;
    
    -- Send notification if relevant
    IF should_notify THEN
        payload := json_build_object(
            'table', TG_TABLE_NAME,
            'pk', pk_value,
            'action', TG_OP,
            'timestamp', extract(epoch from now())
        );
        PERFORM pg_notify('rag_update', payload::text);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function for DELETE operations (uses OLD instead of NEW)
CREATE OR REPLACE FUNCTION public.notify_rag_update_delete()
RETURNS TRIGGER AS $$
DECLARE
    payload JSON;
    pk_value TEXT;
BEGIN
    -- Get primary key value from OLD record
    IF TG_TABLE_NAME = 'devices' THEN
        pk_value := OLD.de_id::text;
    ELSIF TG_TABLE_NAME = 'device_childs' THEN
        pk_value := OLD.dec_id::text;
    ELSIF TG_TABLE_NAME = 'categories' THEN
        pk_value := OLD.ca_id::text;
    ELSIF TG_TABLE_NAME = 'borrow_return_tickets' THEN
        pk_value := OLD.brt_id::text;
    ELSIF TG_TABLE_NAME = 'ticket_issues' THEN
        pk_value := OLD.ti_id::text;
    ELSE
        pk_value := 'unknown';
    END IF;
    
    -- Build payload
    payload := json_build_object(
        'table', TG_TABLE_NAME,
        'pk', pk_value,
        'action', 'DELETE',
        'timestamp', extract(epoch from now())
    );
    
    -- Send notification
    PERFORM pg_notify('rag_update', payload::text);
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

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

COMMENT ON FUNCTION public.notify_rag_update() IS 'Trigger function to notify on data changes for RAG updates';
COMMENT ON FUNCTION public.notify_rag_update_delete() IS 'Trigger function for DELETE operations on RAG-tracked tables';