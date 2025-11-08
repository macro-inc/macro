-- Optimize latest-message batch query

-- Index supports fast per-channel backward scans over active messages
CREATE INDEX IF NOT EXISTS idx_messages_channel_created_at_active
    ON messages (channel_id, created_at DESC)
    WHERE deleted_at IS NULL;

