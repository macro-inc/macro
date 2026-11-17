-- no-transaction
-- The Trash list (GET /recents/deleted) pages a user's trashed folders newest
-- first with a keyset on ("deletedAt", id). "Project" has only
-- "Project_userId_idx" for the owner, so without this each page reads every
-- folder the user has; a folder trash also gives all its subfolders one
-- "deletedAt". Partial on the trash, so live folders never enter it.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS "Project_userId_trashed_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Project_userId_trashed_idx"
    ON "Project" ("userId", "deletedAt", id) WHERE "deletedAt" IS NOT NULL;
