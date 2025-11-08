-- Optimize indexes for get_channel API queries

CREATE INDEX IF NOT EXISTS idx_activity_channel_user ON activity(channel_id, user_id);

CREATE INDEX IF NOT EXISTS idx_attachments_channel_created ON attachments(channel_id, created_at ASC);
