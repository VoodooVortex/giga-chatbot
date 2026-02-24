-- ============================================================================
-- Chat Schema Migration
-- NOTE: chat_rooms and chat_messages already exist in main Orbis-Track schema
-- This migration adds any missing indexes or extensions needed for chatbot
-- ============================================================================
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Note: The following tables already exist in Orbis-Track main schema:
-- - chat_rooms (cr_id, cr_us_id, cr_title, created_at, updated_at, last_msg_at)
-- - chat_messages (cm_id, cm_role, cm_content, cm_content_json, cm_status, cm_parent_id, cm_cr_id, created_at)
-- - chat_attachments (catt_id, catt_cm_id, catt_file_path, created_at)
-- Add any missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_cr_id_created_at ON chat_messages (cm_cr_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_messages_role ON chat_messages (cm_role);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_cm_id ON chat_attachments (catt_cm_id);

-- Add index for vector search metadata if needed
-- CREATE INDEX IF NOT EXISTS idx_chat_messages_embedding ON chat_messages USING gin(cm_content_json);
-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE chat_rooms IS 'Chat conversation rooms (managed by Orbis-Track)';

COMMENT ON TABLE chat_messages IS 'Individual messages within chat rooms (managed by Orbis-Track)';

COMMENT ON TABLE chat_attachments IS 'File attachments for chat messages (managed by Orbis-Track)';