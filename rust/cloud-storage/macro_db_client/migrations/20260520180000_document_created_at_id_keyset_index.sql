-- no-transaction
-- Supports keyset (seek-method) pagination over Document for the search
-- backfill orchestrator, which sorts by ("createdAt" ASC, id ASC). Each
-- page is an O(log n) b-tree seek to the cursor position followed by a
-- forward walk of `LIMIT` entries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_created_at_id
    ON "Document" ("createdAt", id);
