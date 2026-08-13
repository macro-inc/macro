-- Persist the user who created and owns an agent session. The value has always
-- existed - the repo already spends it on the dedicated channel's owner -
-- but the session row never stored it.
ALTER TABLE agent_session
    ADD COLUMN owner_id TEXT
        REFERENCES "User"("id") ON DELETE CASCADE;

-- Every existing session's owner is its dedicated channel's owner:
-- the repo's create sets comms_channels.owner_id from the same value, and
-- channel_id is NOT NULL UNIQUE, so this covers every row.
UPDATE agent_session AS s
SET owner_id = c.owner_id
FROM comms_channels AS c
WHERE c.id = s.channel_id;

ALTER TABLE agent_session
    ALTER COLUMN owner_id SET NOT NULL;

-- Sessions no longer own dedicated comms channels. Keep this after the
-- owner backfill because that backfill relies on the existing relation.
ALTER TABLE agent_session
    DROP COLUMN channel_id;
