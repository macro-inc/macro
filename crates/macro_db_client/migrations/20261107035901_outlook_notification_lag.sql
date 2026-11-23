-- The Graph change notification behind a sync stream's wakeup and behind the
-- messages its next delta page queues: when it arrived, so the import can
-- report its lag, and its W3C traceparent, so the sync work joins the
-- webhook's trace. NULL for work queued by polling or an initial import.
-- Adding nullable columns without a default rewrites no rows; the short lock
-- timeout keeps the sync workers' claims from queueing behind it on these
-- busy tables.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_sync_streams ADD COLUMN notified_traceparent TEXT;
ALTER TABLE email_message_reconciliation
    ADD COLUMN notified_at TIMESTAMPTZ,
    ADD COLUMN notified_traceparent TEXT;
