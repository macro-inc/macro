ALTER TABLE agent_session ADD COLUMN history_start_log_id uuid;
-- Composite identity prevents cross-session boundaries even outside the repository.
ALTER TABLE agent_session_log ADD CONSTRAINT agent_session_log_session_id_unique UNIQUE (agent_session_id, id);
ALTER TABLE agent_session ADD CONSTRAINT agent_session_history_start_fk
    FOREIGN KEY (id, history_start_log_id)
    REFERENCES agent_session_log (agent_session_id, id)
    ON DELETE SET NULL (history_start_log_id);
