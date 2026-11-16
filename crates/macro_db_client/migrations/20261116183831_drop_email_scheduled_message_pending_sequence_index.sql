-- no-transaction
-- An inbox's send slots are read from sequence step history, so nothing uses
-- this index.
DROP INDEX CONCURRENTLY IF EXISTS email_scheduled_messages_pending_sequence_idx;
