-- The agent session whose turn, tool or title made the call, so a session's
-- spend can be summed and tied to what opened it (agent_session.source_id,
-- routine_suggestion_session). No foreign key: usage is kept after its session
-- is deleted. Nullable without a default, so adding it rewrites nothing and
-- deployed writers, which omit it, keep working. Old rows stay NULL.
SET LOCAL lock_timeout = '5s';
ALTER TABLE ai_usage ADD COLUMN agent_session_id UUID;
