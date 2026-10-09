-- A provider-hosted cloud reference has no downloadable attachment bytes.
ALTER TABLE email_attachments ADD COLUMN reference_url text;
ALTER TABLE email_sync_streams ADD COLUMN attachments_rechecked boolean NOT NULL DEFAULT false;
