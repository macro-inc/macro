-- ACP messages posted to an external agent's session before its runtime is
-- ready to receive them (no runtime connected, or the ACP bootstrap hasn't
-- completed yet). agent_proxy drains the queue oldest-first into the runtime
-- once the session's ACP bootstrap completes, deleting each row as it is
-- delivered; rows survive restarts and reconnects so a prompt posted before
-- the runtime exists is never lost. Cascading on chat delete keeps permanent
-- deletion exhaustive.
CREATE TABLE agent_proxy_pending_message (
    id         UUID        PRIMARY KEY,
    session_id TEXT        NOT NULL REFERENCES "Chat"(id) ON DELETE CASCADE,
    message    JSONB       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drain order is per-session, oldest first.
CREATE INDEX agent_proxy_pending_message_session_order
    ON agent_proxy_pending_message (session_id, created_at, id);
