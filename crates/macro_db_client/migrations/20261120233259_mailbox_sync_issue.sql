-- Nullable sync health and ordered notification metadata share one parent lock.
-- Old writers/readers ignore the new columns; no backfill or heap rewrite.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_links
    ADD COLUMN mailbox_issue TEXT,
    ADD COLUMN mailbox_retry_at TIMESTAMPTZ,
    ADD COLUMN imap_notification_revision BIGINT,
    ADD COLUMN imap_notification_sync_generation BIGINT,
    ADD COLUMN imap_notification_grant_generation BIGINT;
