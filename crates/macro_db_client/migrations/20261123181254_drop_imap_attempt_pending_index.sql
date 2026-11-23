-- no-transaction
-- The new due index is already valid before retiring this PR-only index.
-- Retire the old created_at index without blocking readers or writers.
-- Rollback: recreate the old (created_at, id) WHERE NOT completed index
-- concurrently after dropping the replacement from the preceding migration.
DROP INDEX CONCURRENTLY IF EXISTS email_imap_connection_attempts_pending;
