-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_id_covering
    ON "Document" (id)
    INCLUDE ("updatedAt", "deletedAt");
