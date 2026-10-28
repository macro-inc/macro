-- no-transaction
-- Recovery only scans claimed sessions; released history is not part of the sweep.
CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_session_manager_replica_idx
    ON agent_session (manager_replica_id, id)
    WHERE manager_replica_id IS NOT NULL;
