-- Code-mode UI records stay outside model context. Session deletion removes its
-- executions; each lookup checks both the session and the execution identity.
CREATE TABLE agent_code_execution (
    id UUID PRIMARY KEY,
    agent_session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    record JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports session cascades and future session-scoped cleanup.
CREATE INDEX agent_code_execution_session_idx ON agent_code_execution (agent_session_id);
