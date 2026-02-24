-- ============================================================================
-- Chat Schema Migration
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create chat schema
CREATE SCHEMA IF NOT EXISTS chat;

-- Chat Rooms Table
CREATE TABLE chat.chat_rooms (
    cr_id BIGSERIAL PRIMARY KEY,
    cr_title VARCHAR(255),
    cr_user_id UUID NOT NULL,
    cr_status VARCHAR(50) DEFAULT 'active' NOT NULL,
    cr_created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    cr_updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for chat_rooms
CREATE INDEX chat_rooms_user_id_idx ON chat.chat_rooms(cr_user_id);
CREATE INDEX chat_rooms_status_idx ON chat.chat_rooms(cr_status);
CREATE INDEX chat_rooms_created_at_idx ON chat.chat_rooms(cr_created_at);

-- Chat Messages Table
CREATE TABLE chat.chat_messages (
    cm_id BIGSERIAL PRIMARY KEY,
    cm_cr_id BIGINT NOT NULL REFERENCES chat.chat_rooms(cr_id) ON DELETE CASCADE,
    cm_role VARCHAR(50) NOT NULL CHECK (cm_role IN ('user', 'assistant', 'system', 'tool')),
    cm_content TEXT NOT NULL,
    cm_tool_calls JSONB,
    cm_tool_call_id VARCHAR(255),
    cm_created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for chat_messages
CREATE INDEX chat_messages_room_id_idx ON chat.chat_messages(cm_cr_id);
CREATE INDEX chat_messages_created_at_idx ON chat.chat_messages(cm_created_at);

-- Chat Attachments Table
CREATE TABLE chat.chat_attachments (
    ca_id BIGSERIAL PRIMARY KEY,
    ca_cm_id BIGINT NOT NULL REFERENCES chat.chat_messages(cm_id) ON DELETE CASCADE,
    ca_filename VARCHAR(255) NOT NULL,
    ca_mime_type VARCHAR(100) NOT NULL,
    ca_file_size BIGINT NOT NULL,
    ca_storage_path VARCHAR(500) NOT NULL,
    ca_created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for chat_attachments
CREATE INDEX chat_attachments_message_id_idx ON chat.chat_attachments(ca_cm_id);

-- Update trigger for cr_updated_at
CREATE OR REPLACE FUNCTION chat.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.cr_updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_chat_rooms_updated_at
    BEFORE UPDATE ON chat.chat_rooms
    FOR EACH ROW
    EXECUTE FUNCTION chat.update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE chat.chat_rooms IS 'Chat conversation rooms';
COMMENT ON TABLE chat.chat_messages IS 'Individual messages within chat rooms';
COMMENT ON TABLE chat.chat_attachments IS 'File attachments for chat messages';

COMMENT ON COLUMN chat.chat_rooms.cr_status IS 'Room status: active, archived, deleted';
COMMENT ON COLUMN chat.chat_messages.cm_role IS 'Message role: user, assistant, system, or tool';
COMMENT ON COLUMN chat.chat_messages.cm_tool_calls IS 'JSON array of tool calls made by assistant';
COMMENT ON COLUMN chat.chat_messages.cm_tool_call_id IS 'ID for matching tool responses to tool calls';