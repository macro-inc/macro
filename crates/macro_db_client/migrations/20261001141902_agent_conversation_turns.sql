-- One row per channel message an agent answers: admitted before the broker
-- event is acknowledged, then claimed, run and reconciled in order. Two agents
-- in one channel each keep their own turn for the same message.
CREATE TABLE agent_conversation_turns (
    source_message_id UUID NOT NULL,
    bot_id UUID NOT NULL,
    session_id UUID NOT NULL REFERENCES agent_conversation_sessions(session_id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    action_id UUID NOT NULL UNIQUE,
    command JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'stopped', 'interrupted')),
    in_flight JSONB,
    outcome JSONB,
    reply_finalized BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_message_id, bot_id)
);

CREATE INDEX agent_conversation_turns_pending ON agent_conversation_turns(created_at, source_message_id) WHERE state = 'queued';
CREATE INDEX agent_conversation_turns_channel ON agent_conversation_turns(channel_id, created_at);
CREATE INDEX agent_conversation_turns_replies ON agent_conversation_turns(updated_at) WHERE outcome IS NOT NULL AND NOT reply_finalized;
