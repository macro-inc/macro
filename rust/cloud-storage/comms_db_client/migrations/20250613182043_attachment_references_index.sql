CREATE INDEX IF NOT EXISTS idx_attachments_entity_created
    ON attachments (entity_type, entity_id, created_at DESC)
    INCLUDE (channel_id, message_id);

CREATE INDEX IF NOT EXISTS idx_cp_active_by_channel_user
    ON channel_participants (channel_id, user_id)
    WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_active
    ON messages (id)
    WHERE deleted_at IS NULL;
