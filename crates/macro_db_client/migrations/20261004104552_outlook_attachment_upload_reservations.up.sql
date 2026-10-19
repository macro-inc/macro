SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
ALTER TABLE email_attachments_drafts
    ADD COLUMN upload_pending boolean NOT NULL DEFAULT false,
    ADD COLUMN upload_expires_at timestamptz,
    ADD COLUMN content_id text,
    ADD COLUMN is_inline boolean NOT NULL DEFAULT false;

-- Build email_draft_upload_expiration concurrently after committing these columns.
