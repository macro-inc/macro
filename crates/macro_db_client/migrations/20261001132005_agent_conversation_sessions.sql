-- An agent's conversation in a channel runs on one session at a time.
-- The session id is reserved before its runtime is provisioned, so the
-- session may not exist yet and session_id deliberately has no session FK.
-- Earlier sessions stay associated with the conversation after starting fresh.
CREATE TABLE agent_conversation_sessions (
    session_id UUID PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    bot_id UUID NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agent_conversation_sessions_current
    ON agent_conversation_sessions (channel_id, bot_id) WHERE is_current;

CREATE INDEX agent_conversation_sessions_history
    ON agent_conversation_sessions (channel_id, bot_id, created_at DESC, session_id DESC);
