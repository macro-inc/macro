-- no-transaction
-- Preserve provider waits on reconnect without scanning every stream of a link.
-- If an interrupted build leaves this index INVALID, drop that invalid index
-- before retrying: IF NOT EXISTS does not repair an invalid concurrent build.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS email_sync_streams_imap_retry_max;
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_sync_streams_imap_retry_max
    ON email_sync_streams (link_id, generation, provider_retry_at)
    WHERE provider_retry_at IS NOT NULL AND provider = 'IMAP';
