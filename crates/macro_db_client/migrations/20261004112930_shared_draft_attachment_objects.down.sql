-- Downgrade only after outstanding transfers no longer share objects.
DROP INDEX email_attachments_drafts_s3_key;
ALTER TABLE email_attachments_drafts ADD CONSTRAINT email_attachments_drafts_s3_key_key UNIQUE(s3_key);
