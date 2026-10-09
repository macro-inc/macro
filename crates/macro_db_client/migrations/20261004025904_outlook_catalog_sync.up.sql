ALTER TABLE email_sync_streams DROP CONSTRAINT email_sync_streams_kind_check;
ALTER TABLE email_sync_streams ADD CONSTRAINT email_sync_streams_kind_check
    CHECK (kind IN ('folder_catalog','mail_folder','gmail_history','gmail_backfill','contacts','calendar'));

-- Deduplication is committed with ingestion, before any downstream delivery.
ALTER TABLE email_projection_outbox ADD COLUMN dedupe_key text UNIQUE;
