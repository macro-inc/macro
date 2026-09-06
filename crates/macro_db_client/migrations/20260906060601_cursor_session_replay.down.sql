DROP TABLE cursor_journal_input;

ALTER TABLE agent_session DROP CONSTRAINT agent_session_history_start_fk;
ALTER TABLE agent_session DROP COLUMN history_start_log_id;
ALTER TABLE agent_session_log DROP CONSTRAINT agent_session_log_session_id_unique;

ALTER TABLE external_agent_session
DROP CONSTRAINT external_agent_session_last_run_id_not_empty,
DROP COLUMN last_run_id;
