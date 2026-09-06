ALTER TABLE external_agent_session
ADD COLUMN last_run_id TEXT;

ALTER TABLE external_agent_session
ADD CONSTRAINT external_agent_session_last_run_id_not_empty
CHECK (last_run_id IS NULL OR last_run_id <> '');
