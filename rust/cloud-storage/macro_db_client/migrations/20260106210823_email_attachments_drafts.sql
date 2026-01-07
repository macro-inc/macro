CREATE TABLE email_attachments_drafts
(
    id            UUID PRIMARY KEY,
    draft_id UUID        NOT NULL REFERENCES email_messages (id) ON DELETE CASCADE,
    file_name     TEXT        NOT NULL,
    content_type  TEXT        NOT NULL,
    sha           TEXT        NOT NULL,
    size          INTEGER     NOT NULL,
    s3_key        TEXT        NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_attachments_drafts_message_db_id ON email_attachments_drafts (draft_id);