-- The channel relation cannot be rebuilt - which session owned which channel
-- was only recorded here - so coming back down restores the column empty and
-- nullable rather than pretending otherwise.
ALTER TABLE agent_session
    ADD COLUMN channel_id UUID UNIQUE REFERENCES comms_channels(id) ON DELETE CASCADE;
