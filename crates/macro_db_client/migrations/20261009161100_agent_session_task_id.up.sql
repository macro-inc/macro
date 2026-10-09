-- The task a coding-agent session works on, at most one. Relinking replaces it;
-- deleting the task document unlinks it rather than deleting the session.
ALTER TABLE agent_session
    ADD COLUMN task_id TEXT REFERENCES "Document" (id) ON DELETE SET NULL;

CREATE INDEX idx_agent_session_task_id ON agent_session (task_id) WHERE task_id IS NOT NULL;
