ALTER TABLE external_agent_session
ADD COLUMN last_run_id TEXT;

ALTER TABLE external_agent_session
ADD CONSTRAINT external_agent_session_last_run_id_not_empty
CHECK (last_run_id IS NULL OR last_run_id <> '');

ALTER TABLE agent_session ADD COLUMN history_start_log_id uuid;
-- Composite identity prevents cross-session boundaries even outside the repository.
ALTER TABLE agent_session_log ADD CONSTRAINT agent_session_log_session_id_unique UNIQUE (agent_session_id, id);
ALTER TABLE agent_session ADD CONSTRAINT agent_session_history_start_fk
    FOREIGN KEY (id, history_start_log_id)
    REFERENCES agent_session_log (agent_session_id, id);

-- PostgreSQL 14 cannot SET NULL on only part of a composite foreign key.
-- Clear the history boundary before deleting its log, without nulling the session id.
CREATE FUNCTION clear_agent_session_history_start_on_log_delete()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE agent_session
    SET history_start_log_id = NULL
    WHERE id = OLD.agent_session_id AND history_start_log_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_session_log_clear_history_start
    BEFORE DELETE ON agent_session_log
    FOR EACH ROW
    EXECUTE FUNCTION clear_agent_session_history_start_on_log_delete();

-- Cursor's native journal is separate from the ACP delivery watermark.
-- Provider identity remains in external_agent_session. Inputs may precede
-- creation of that mapping (e.g. a new, empty session).
CREATE TABLE cursor_journal_input (
    agent_session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL CHECK (sequence > 0),
    run_id TEXT CHECK (run_id <> ''),
    input JSONB NOT NULL,
    inserted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_session_id, sequence)
);
CREATE INDEX cursor_journal_input_run ON cursor_journal_input(agent_session_id, run_id, sequence);
