-- Persist the user who started an agent session. The value has always
-- existed - the repo already spends it on the dedicated channel's owner -
-- but the session row never stored it.
ALTER TABLE agent_session
    ADD COLUMN initiator_user_id TEXT
        REFERENCES "User"("id") ON DELETE CASCADE;

-- Every existing session's initiator is its dedicated channel's owner:
-- the repo's create sets comms_channels.owner_id from the same value, and
-- channel_id is NOT NULL UNIQUE, so this covers every row.
UPDATE agent_session AS s
SET initiator_user_id = c.owner_id
FROM comms_channels AS c
WHERE c.id = s.channel_id;

ALTER TABLE agent_session
    ALTER COLUMN initiator_user_id SET NOT NULL;
