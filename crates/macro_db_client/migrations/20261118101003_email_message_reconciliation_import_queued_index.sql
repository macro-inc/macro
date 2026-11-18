-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- Counts a mailbox's due import rows for Outlook import pacing (`pace_import`):
-- without it a mailbox with fewer due rows than the count's cap reads the whole
-- table. The predicate must match the query's. If a build is interrupted, drop
-- the INVALID index before this migration runs again.
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_message_reconciliation_import_queued
    ON email_message_reconciliation (link_id, generation, available_at)
    WHERE is_import AND available_at <> 'infinity';
