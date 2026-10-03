-- no-transaction
-- Single statement on purpose: see the note in
-- 20260715154137_add_entity_access_source_type_entity_plain_index.sql.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_history_user_type_updated_item
    ON "UserHistory" ("userId", "itemType", "updatedAt", "itemId");
