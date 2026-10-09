-- Sender transfers retain immutable bytes until every draft/reference releases them.
ALTER TABLE email_attachments_drafts DROP CONSTRAINT email_attachments_drafts_s3_key_key;
CREATE INDEX email_attachments_drafts_s3_key ON email_attachments_drafts(s3_key);
