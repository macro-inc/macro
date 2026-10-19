-- no-transaction
CREATE INDEX CONCURRENTLY email_draft_upload_expiration
    ON email_attachments_drafts (upload_expires_at) WHERE upload_pending;
