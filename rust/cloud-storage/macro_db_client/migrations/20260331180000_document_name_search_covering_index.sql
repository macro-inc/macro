-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_name_search_covering
    ON "Document" (id)
    INCLUDE (name, "updatedAt", "deletedAt");
