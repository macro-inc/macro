-- Reserve a stable session id before asynchronously provisioning its runtime.
-- The session may not exist yet, so session_id deliberately has no session FK.
-- Historical segments remain associated with the DM after starting fresh.
CREATE TABLE agent_dm_conversations (
    session_id UUID PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agent_dm_conversations_current
    ON agent_dm_conversations (channel_id) WHERE is_current;

CREATE INDEX agent_dm_conversations_history
    ON agent_dm_conversations (channel_id, created_at DESC, session_id DESC);
