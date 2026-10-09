-- Add up migration script here
ALTER TABLE email_attachments_drafts
    ADD COLUMN upload_pending boolean NOT NULL DEFAULT false,
    ADD COLUMN upload_expires_at timestamptz,
    ADD COLUMN content_id text,
    ADD COLUMN is_inline boolean NOT NULL DEFAULT false;

CREATE INDEX email_draft_upload_expiration ON email_attachments_drafts(upload_expires_at)
    WHERE upload_pending;
