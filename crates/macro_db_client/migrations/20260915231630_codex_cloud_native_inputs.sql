-- Native Codex observations, captured before interpretation in local session order.
-- Existing codex_cloud_sessions remains the metadata and task/turn receipt record.
-- Old projected history is deliberately not promoted into native input history.
CREATE TABLE codex_journal_input (
    agent_session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL CHECK (sequence > 0),
    turn_id TEXT,
    input JSONB NOT NULL,
    PRIMARY KEY (agent_session_id, sequence)
);
