-- no-transaction
-- Counts a mailbox's due live rows before a change notification queues another
-- (`accept_notification`), so one mailbox's notifications cannot put every
-- other mailbox's new mail behind its own. Without it the count reads the
-- mailbox's import rows too. The predicate must match the query's.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a
-- batch. No IF NOT EXISTS, so an INVALID index left by an interrupted build
-- fails the next run instead of passing: drop it by hand and run again.
-- Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY email_message_reconciliation_live_queued
    ON email_message_reconciliation (link_id, generation, available_at)
    WHERE NOT is_import AND available_at <> 'infinity';
