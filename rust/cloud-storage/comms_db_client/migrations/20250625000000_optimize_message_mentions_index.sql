-- Optimize message_mentions index for get_attachment_references query
-- This composite index matches the query pattern and improves performance

-- Drop the existing single-column index if it exists
DROP INDEX IF EXISTS idx_message_mentions_entity_id;

-- Create composite index for efficient filtering and joining
CREATE INDEX IF NOT EXISTS idx_message_mentions_entity_type_id
    ON message_mentions (entity_type, entity_id)
    INCLUDE (message_id);

-- Add index on messages for efficient ordering when joined from message_mentions
CREATE INDEX IF NOT EXISTS idx_messages_created_at_active
    ON messages (created_at DESC)
    WHERE deleted_at IS NULL;