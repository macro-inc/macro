-- no-transaction
-- Idle catch-up scans only unconsumed IMAP hints, not the whole mailbox fleet.
-- Single statement; an interrupted INVALID build must fail visibly. Inspect
-- pg_index.indisvalid and remove the invalid index before retrying migration.
CREATE INDEX CONCURRENTLY email_sync_streams_imap_pending_hint
    ON email_sync_streams (id)
    WHERE provider = 'IMAP'
        AND kind IN ('folder_catalog', 'mail_folder')
        AND notification_revision > leased_notification_revision;
