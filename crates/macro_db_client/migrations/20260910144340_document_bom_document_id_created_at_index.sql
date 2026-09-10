-- no-transaction
-- Same defect as idx_document_instance_document_id_updated_at, one table over:
--   SELECT b.id FROM "DocumentBom" b
--   WHERE b."documentId" = d.id ORDER BY b."createdAt" DESC LIMIT 1
-- runs once per soup detail row against a bare ("documentId") index, so the
-- sort is unavoidable without the timestamp in the index.
-- Single statement: see 20260910144339 for the CONCURRENTLY constraint.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_bom_document_id_created_at
    ON "DocumentBom" ("documentId", "createdAt" DESC);
