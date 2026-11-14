-- no-transaction
-- A thread's replies, newest first, and the deletion cascade from a root.
-- IF NOT EXISTS does not repair an INVALID index left by an interrupted
-- build: check pg_index.indisvalid and drop it before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS external_chat_message_thread ON external_chat_message(thread_root, source_at DESC, id DESC) WHERE thread_root IS NOT NULL;
