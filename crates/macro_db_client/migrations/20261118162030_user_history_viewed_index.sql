-- no-transaction
-- Soup's view-time sorts read one user's history of an item type, most recent view first, and stop
-- at the page. Without this index they sort the user's whole history of the type first.
-- Keep a single statement: a SQLx simple-query batch with multiple statements gets an implicit
-- transaction, which CONCURRENTLY forbids.
-- An interrupted build can leave an invalid index; inspect pg_index.indisvalid, drop the invalid
-- index concurrently, then retry this migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_history_user_type_updated
    ON "UserHistory" ("userId", "itemType", "updatedAt" DESC, "itemId" DESC);
