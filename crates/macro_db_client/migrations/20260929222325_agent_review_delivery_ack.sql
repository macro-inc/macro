-- Review feedback keeps its own durable payload until an incoming ACP response.
-- Admission alone cannot prove that a socket write reached the runtime.
DROP TABLE agent_session_action_receipt;
CREATE INDEX agent_session_completed_action_idx
ON agent_session_log (agent_session_id, (content->>'id'))
WHERE direction = 'to_server' AND (content ? 'result' OR content ? 'error');
