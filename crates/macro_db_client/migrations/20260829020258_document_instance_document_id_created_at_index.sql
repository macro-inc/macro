-- no-transaction
-- Latest-instance check after a sha hit: ORDER BY createdAt DESC LIMIT 1
-- per document. DocumentInstance_documentId_idx cannot satisfy the sort.
-- Must stay a single statement: see 20260829020240_document_instance_sha_index.sql.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_instance_document_id_created_at
    ON "DocumentInstance" ("documentId", "createdAt" DESC);
