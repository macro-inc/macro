-- A session no longer owns a dedicated comms channel: nothing creates one,
-- nothing resolves a session through one, and the log is served by session
-- id. The column goes with the relation (its unique constraint and foreign
-- key go with it).
--
-- Channels that old sessions created stay behind in comms_channels as
-- ordinary channels; nothing links back to them.
ALTER TABLE agent_session
    DROP COLUMN channel_id;
