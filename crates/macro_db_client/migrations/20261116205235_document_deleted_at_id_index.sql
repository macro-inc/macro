-- no-transaction
-- The deleted item poller pages through documents trashed before the
-- retention cutoff in ("deletedAt", id) order. Without this index every run
-- read the whole Document table to find them. Partial on trashed rows: live
-- documents never enter it, and "deletedAt" is already indexed, so no update
-- that was HOT before stops being HOT.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a
-- batch. No IF NOT EXISTS, so an INVALID index left by an interrupted build
-- fails the next run instead of passing: drop it by hand and run again.
-- Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_document_deleted_at_id;
CREATE INDEX CONCURRENTLY idx_document_deleted_at_id
    ON "Document" ("deletedAt", id)
    WHERE "deletedAt" IS NOT NULL;
