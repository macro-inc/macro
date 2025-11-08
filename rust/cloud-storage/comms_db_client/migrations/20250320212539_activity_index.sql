-- Add migration script here
CREATE INDEX IF NOT EXISTS idx_activity_channel_id_user_id ON activity(user_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_attachments_channel_Id ON attachments(channel_id);
