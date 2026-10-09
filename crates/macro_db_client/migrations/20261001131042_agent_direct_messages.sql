-- A persona DM has a durable identity independent of its agent sessions.
-- Bot ids include built-in personas without a bots row, so no bot FK is used.
-- User cleanup deletes owned channels; deleting a channel removes this binding.
CREATE TABLE comms_agent_dms (
    channel_id UUID PRIMARY KEY REFERENCES comms_channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    bot_id UUID NOT NULL,
    UNIQUE (user_id, bot_id)
);
