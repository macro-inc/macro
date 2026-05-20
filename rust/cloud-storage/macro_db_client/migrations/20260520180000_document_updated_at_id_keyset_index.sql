-- no-transaction
-- Supports keyset (seek-method) pagination over Document for the search
-- backfill orchestrator, which sorts by ("updatedAt" ASC, id ASC). Each
-- page is an O(log n) b-tree seek to the cursor position followed by a
-- forward walk of `LIMIT` entries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_updated_at_id
    ON "Document" ("updatedAt", id);
