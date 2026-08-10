-- Agent turns render in channels as ordinary comms messages whose content is
-- not stored: the row is a placeholder carrying a reference to an agent
-- session turn, and the body is folded from agent_session_log on read (see
-- agent_session::domain). agent_session_turn_id is an ephemeral composite id
-- ("{agent_session_id}:{offset}") — turns have no table, so this is TEXT with
-- no FK; a dangling id after session deletion is a harmless lookup miss.
ALTER TABLE comms_messages
    ALTER COLUMN content DROP NOT NULL,
    ADD COLUMN agent_session_turn_id TEXT;

-- A message stores its content, points at a turn, or both - never neither.
ALTER TABLE comms_messages
    ADD CONSTRAINT comms_messages_content_or_turn_check
        CHECK (num_nonnulls(content, agent_session_turn_id) >= 1);

-- One placeholder per turn: appends refold the session and diff against
-- existing placeholders, so this backstops that diff against double-writes.
CREATE UNIQUE INDEX comms_messages_agent_session_turn_unique
    ON comms_messages (agent_session_turn_id)
    WHERE agent_session_turn_id IS NOT NULL;
