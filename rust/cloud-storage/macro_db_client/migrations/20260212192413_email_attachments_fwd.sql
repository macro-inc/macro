CREATE TABLE IF NOT EXISTS email_attachments_fwd (
    message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL REFERENCES email_attachments(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS idx_email_attachments_fwd_attachment_id ON email_attachments_fwd(attachment_id);
