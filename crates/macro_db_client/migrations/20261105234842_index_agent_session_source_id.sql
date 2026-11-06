-- no-transaction
-- Keeps the foreign key check on a source's delete from scanning agent_session.
CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_session_source_id_idx
ON agent_session (source_id)
WHERE source_id IS NOT NULL;
