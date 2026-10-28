-- An agent persona that converses in a channel. A direct conversation is a
-- private channel between one user and one persona; a member agent converses
-- in a shared channel. Only direct conversations are created today.
-- Bot ids include built-in personas without a bots row, so no bot FK is used.
-- User cleanup deletes owned channels; deleting a channel removes its agents.
CREATE TABLE comms_channel_agents (
    channel_id UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    bot_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('direct', 'member')),
    -- The owner of a direct conversation; member agents have none.
    user_id TEXT,
    PRIMARY KEY (channel_id, bot_id),
    CHECK ((kind = 'direct') = (user_id IS NOT NULL))
);

-- One direct conversation per user and persona, with one persona in it.
CREATE UNIQUE INDEX comms_channel_agents_direct_pair
    ON comms_channel_agents (user_id, bot_id) WHERE kind = 'direct';
CREATE UNIQUE INDEX comms_channel_agents_direct_channel
    ON comms_channel_agents (channel_id) WHERE kind = 'direct';
