ALTER TABLE agent_session
    ADD COLUMN channel_id UUID UNIQUE REFERENCES comms_channels(id) ON DELETE CASCADE;

-- The original channel relation cannot be rebuilt after channel_id is dropped,
-- so rollback restores an empty, nullable column.
ALTER TABLE agent_session
    DROP COLUMN owner_id;
