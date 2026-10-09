-- Add down migration script here
DROP INDEX email_draft_upload_expiration;
ALTER TABLE email_attachments_drafts DROP COLUMN upload_pending,
    DROP COLUMN upload_expires_at, DROP COLUMN content_id, DROP COLUMN is_inline;
