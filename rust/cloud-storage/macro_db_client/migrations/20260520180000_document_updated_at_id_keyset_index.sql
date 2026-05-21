-- no-transaction
-- Supports keyset pagination over Document for the search backfill
-- orchestrator, which sorts by ("updatedAt" ASC, id ASC).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_updated_at_id
    ON "Document" ("updatedAt", id);
