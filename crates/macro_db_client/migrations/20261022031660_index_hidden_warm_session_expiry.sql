-- no-transaction
-- The warm reaper's predicate now reads `visibility`; this replaces
-- `agent_session_warm_expiry`, which a later migration drops with `list_hidden`.
CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_session_hidden_warm_expiry
    ON agent_session (created_at)
    WHERE for_warming AND visibility = 'hidden' AND thread_id IS NULL;
