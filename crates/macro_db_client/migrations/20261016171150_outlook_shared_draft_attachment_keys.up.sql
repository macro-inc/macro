SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

-- The concurrent replacement index is already valid before shared keys are allowed.
ALTER TABLE email_attachments_drafts DROP CONSTRAINT email_attachments_drafts_s3_key_key;
