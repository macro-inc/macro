-- An external agent is an agent persona on the `external` harness whose
-- runtime lives outside Macro. The runtime reads the agent's events by
-- polling the API, or receives them at a webhook endpoint, and answers them
-- through the API with the agent's bot token.
CREATE TABLE external_agents (
    bot_id UUID PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
    -- The webhook the agent's events are pushed to; null while its runtime polls.
    webhook_id TEXT UNIQUE REFERENCES webhook(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every message that addressed an external agent, in arrival order. An event
-- also authorizes the agent's reply to it: the agent answers where it was
-- addressed, with the current access of the person who addressed it.
CREATE TABLE external_agent_events (
    id UUID PRIMARY KEY,
    bot_id UUID NOT NULL REFERENCES external_agents(bot_id) ON DELETE CASCADE,
    -- The agent-trigger broker event it was recorded from, so a redelivered
    -- trigger records nothing new.
    trigger_event_id UUID NOT NULL,
    kind TEXT NOT NULL
        CONSTRAINT external_agent_events_kind_valid CHECK (kind IN ('direct_message', 'mention')),
    parent_type TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    message_id UUID NOT NULL,
    message_thread_id UUID NULL,
    -- Where the agent's reply goes: null on a direct conversation's timeline.
    reply_thread_id UUID NULL,
    sender_id TEXT NOT NULL,
    invoking_user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    message_created_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT external_agent_events_trigger_unique UNIQUE (bot_id, trigger_event_id)
);

CREATE INDEX external_agent_events_bot_id_id_idx ON external_agent_events (bot_id, id);
