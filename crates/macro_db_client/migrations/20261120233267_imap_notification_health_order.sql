SET LOCAL lock_timeout = '5s';

-- Nullable additive metadata; no row backfill or table rewrite. Old senders
-- remain accepted during rollout/rollback, while versioned hints are ordered.
ALTER TABLE email_links
    ADD COLUMN imap_notification_revision BIGINT,
    ADD COLUMN imap_notification_sync_generation BIGINT,
    ADD COLUMN imap_notification_grant_generation BIGINT;
