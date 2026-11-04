-- Reapers visit only speculative hidden/unthreaded sessions, oldest first.
-- No existing session index covers created_at or this expiry predicate.
CREATE INDEX agent_session_warm_expiry ON agent_session (created_at)
WHERE for_warming AND list_hidden AND thread_id IS NULL;
