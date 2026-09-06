-- Cursor's native journal is separate from the ACP delivery watermark.
-- Provider identity remains in external_agent_session. Inputs may precede
-- creation of that mapping (e.g. a new, empty session).
CREATE TABLE cursor_journal_input (
    agent_session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL CHECK (sequence > 0),
    run_id TEXT CHECK (run_id <> ''),
    input JSONB NOT NULL,
    PRIMARY KEY (agent_session_id, sequence)
);
CREATE INDEX cursor_journal_input_run ON cursor_journal_input(agent_session_id, run_id, sequence);
