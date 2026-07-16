-- no-transaction
-- Chat counterpart of idx_document_live_id_owner: index-only liveness and
-- owner check for the accessible-items query.
--
-- Single statement on purpose: see the note in
-- 20260715154137_add_entity_access_source_type_entity_plain_index.sql.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_live_id_user
    ON "Chat" (id) INCLUDE ("userId") WHERE "deletedAt" IS NULL;
