-- no-transaction
-- Supports keyset pagination over ChatMessage for the search backfill
-- orchestrator, which sorts by ("updatedAt" ASC, id ASC).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_message_updated_at_id
    ON "ChatMessage" ("updatedAt", id);
