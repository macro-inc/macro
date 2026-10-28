-- no-transaction
-- The soup detail stage resolves each row's current instance with
--   SELECT i.id, i.sha FROM "DocumentInstance" i
--   WHERE i."documentId" = d.id ORDER BY i."updatedAt" DESC LIMIT 1
-- (crates/soup, crates/projects). The only ordered index on this table is
-- idx_document_instance_document_id_created_at, which orders by "createdAt" --
-- a different column -- so every lateral reads all of a document's instances
-- and sorts them to return one row.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_instance_document_id_updated_at
    ON "DocumentInstance" ("documentId", "updatedAt" DESC);
