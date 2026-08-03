-- One row per message exchanged on an agent session's logical protocol
-- stream (see agent_runtime_protocol::domain::schema::v0 and
-- agent_session::domain::model::{Message, AgentSessionLog}). direction +
-- content together round-trip the Message enum (ToServer/ToRuntime); user_id
-- is set only when the entry is ACP traffic that originated from a user.
CREATE TABLE agent_session_log (
    id                UUID        PRIMARY KEY,
    agent_session_id  UUID        NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    user_id           TEXT,
    direction         TEXT        NOT NULL CHECK (direction IN ('to_server', 'to_runtime')),
    content           JSONB       NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- list_by_session reads a session's log in chronological order.
CREATE INDEX agent_session_log_session_order
    ON agent_session_log (agent_session_id, created_at, id);
