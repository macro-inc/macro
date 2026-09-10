-- Agent identity and ownership live in `bots`; this table holds only the
-- agent-specific behavior and runtime selection. Channel reach remains in
-- `comms_channel_participants`, shared with every other bot.
CREATE TABLE agent_configs (
    bot_id UUID PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
    instructions TEXT NOT NULL,
    harness TEXT NOT NULL,
    default_model TEXT NOT NULL,
    channel_scope TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_configs_harness_not_empty CHECK (harness <> ''),
    CONSTRAINT agent_configs_default_model_not_empty CHECK (default_model <> ''),
    CONSTRAINT agent_configs_channel_scope_valid
        CHECK (channel_scope IN ('all', 'selected'))
);
