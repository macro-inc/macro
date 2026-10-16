-- no-transaction
-- Build the replacement before dropping the existing s3_key unique constraint.
CREATE INDEX CONCURRENTLY email_attachments_drafts_s3_key ON email_attachments_drafts (s3_key);
