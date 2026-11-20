-- no-transaction
-- The Trash list (GET /recents/deleted) pages a user's trashed chats newest
-- first with a keyset on ("deletedAt", id). "Chat" has only "Chat_userId_idx"
-- for the owner, so without this each page reads every chat the user has,
-- live ones included. Partial on the trash, so live chats never enter it.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS "Chat_userId_trashed_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Chat_userId_trashed_idx"
    ON "Chat" ("userId", "deletedAt", id) WHERE "deletedAt" IS NOT NULL;
