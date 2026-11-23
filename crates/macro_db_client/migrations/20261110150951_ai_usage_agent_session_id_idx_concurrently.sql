-- no-transaction
-- Finds one agent session's usage rows. Partial: chat, email and other
-- non-session usage has no session. Built CONCURRENTLY so completions keep
-- writing. IF NOT EXISTS does not repair an INVALID index left by an
-- interrupted build: check `SELECT indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('ai_usage_agent_session_id_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY ai_usage_agent_session_id_idx` before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_usage_agent_session_id_idx
    ON ai_usage (agent_session_id)
    WHERE agent_session_id IS NOT NULL;
