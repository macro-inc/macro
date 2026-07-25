-- no-transaction
-- Covering partial index so the accessible-items query can verify that a
-- granted document still exists, is not soft-deleted, and (optionally) is
-- not owned by the caller without touching the Document heap. Partial on
-- live rows keeps it small enough to stay cached.
--
-- Single statement on purpose: see the note in
-- 20260715154137_add_entity_access_source_type_entity_plain_index.sql.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_live_id_owner
    ON "Document" (id) INCLUDE (owner) WHERE "deletedAt" IS NULL;
