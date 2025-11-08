-- Add migration script here
CREATE INDEX IF NOT EXISTS idx_message_mentions_entity_id ON message_mentions(entity_id);
