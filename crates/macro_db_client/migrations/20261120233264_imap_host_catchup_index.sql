-- no-transaction
-- Stable row-bounded startup paging, independent of mutable stream due times.
-- Single statement: CONCURRENTLY cannot run inside an implicit transaction.
-- No IF NOT EXISTS: an interrupted INVALID build must fail visibly. Inspect
-- pg_index.indisvalid and remove the invalid index before retrying migration.
CREATE INDEX CONCURRENTLY email_sync_streams_imap_catchup
    ON email_sync_streams (id)
    WHERE provider = 'IMAP' AND kind IN ('folder_catalog', 'mail_folder');
