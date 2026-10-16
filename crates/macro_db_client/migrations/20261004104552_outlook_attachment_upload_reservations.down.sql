-- Add down migration script here
ALTER TABLE email_attachments_drafts DROP COLUMN upload_pending,
    DROP COLUMN upload_expires_at, DROP COLUMN content_id, DROP COLUMN is_inline;
