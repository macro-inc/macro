-- no-transaction
-- Soup's owner filter reads one owner's live documents newest first.
-- Keep a single statement: a SQLx simple-query batch with multiple statements gets an implicit
-- transaction, which CONCURRENTLY forbids.
-- An interrupted build can leave an invalid index; inspect pg_index.indisvalid, drop the invalid
-- index concurrently, then retry this migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_owner_updated_live
    ON "Document" (owner, "updatedAt" DESC, id DESC)
    WHERE "deletedAt" IS NULL;
