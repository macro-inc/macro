-- no-transaction
CREATE INDEX CONCURRENTLY agent_session_owner_active_turn_state_idx
ON agent_session (owner_id, turn_state, modified_at DESC)
WHERE NOT is_archived AND turn_state IN ('blocked', 'running');
