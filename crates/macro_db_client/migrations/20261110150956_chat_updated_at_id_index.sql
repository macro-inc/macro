-- no-transaction
-- Lets the flat Soup query read a chat page's most recently updated rows past
-- its cursor, ordered by ("updatedAt" DESC, id DESC), from the index alone.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_updated_at_id
    ON "Chat" ("updatedAt", id);
