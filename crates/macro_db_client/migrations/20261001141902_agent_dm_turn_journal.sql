CREATE TABLE agent_dm_turn_journal (
    source_message_id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES agent_dm_conversations(session_id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    action_id UUID NOT NULL UNIQUE,
    command JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'stopped', 'interrupted')),
    in_flight JSONB,
    outcome JSONB,
    reply_finalized BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agent_dm_turn_journal_pending ON agent_dm_turn_journal(created_at, source_message_id) WHERE state = 'queued';
CREATE INDEX agent_dm_turn_journal_channel ON agent_dm_turn_journal(channel_id, created_at);
CREATE INDEX agent_dm_turn_journal_replies ON agent_dm_turn_journal(updated_at) WHERE outcome IS NOT NULL AND NOT reply_finalized;
