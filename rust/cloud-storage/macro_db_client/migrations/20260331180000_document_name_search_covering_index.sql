-- no-transaction
DROP INDEX CONCURRENTLY IF EXISTS idx_document_name_search_covering;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_name_search_covering
    ON "Document" (id)
    INCLUDE ("updatedAt", "deletedAt");
