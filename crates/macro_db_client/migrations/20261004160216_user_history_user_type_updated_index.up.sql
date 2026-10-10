-- no-transaction
-- Soup's view-time sorts read one user's history of one item type, most recently viewed first.
-- Keep a single statement: a SQLx simple-query batch with multiple statements gets an implicit
-- transaction, which CONCURRENTLY forbids.
-- An interrupted build can leave an invalid index; inspect pg_index.indisvalid, drop the invalid
-- index concurrently, then retry this migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_history_user_type_updated_item
    ON "UserHistory" ("userId", "itemType", "updatedAt", "itemId");
