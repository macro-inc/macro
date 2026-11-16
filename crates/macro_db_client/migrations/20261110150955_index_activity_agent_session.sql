-- no-transaction

-- One session's activity, newest first, for the session activity read. Partial:
-- only correlated rows have a session, and `opened` rows are reads the session
-- view never shows. IF NOT EXISTS does not repair an INVALID index left by an
-- interrupted build: check `SELECT indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('activity_events_agent_session_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY activity_events_agent_session_idx` before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS activity_events_agent_session_idx
    ON activity_events (agent_session_id, occurred_at DESC, id DESC)
    WHERE agent_session_id IS NOT NULL AND action <> 'opened';
