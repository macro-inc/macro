-- no-transaction
-- The Trash list (GET /recents/deleted) pages an owner's trashed documents
-- newest first with a keyset on ("deletedAt", id). "Document_owner_deletedAt_idx"
-- has no id, so every page inside a group trashed at one moment (a folder
-- trash, a batch move to Trash) reads the whole group to order it. Partial on
-- the trash, so live documents never enter it.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS "Document_owner_trashed_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Document_owner_trashed_idx"
    ON "Document" (owner, "deletedAt", id) WHERE "deletedAt" IS NOT NULL;
