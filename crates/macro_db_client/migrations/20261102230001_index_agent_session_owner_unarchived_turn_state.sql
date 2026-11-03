-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_session_owner_unarchived_turn_state_idx
ON agent_session (owner_id, turn_state, modified_at DESC)
WHERE archived_by IS NULL AND turn_state IN ('blocked', 'running');
