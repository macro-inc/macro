-- Placeholders are derived from agent_session_log, so the per-message rows
-- are dropped rather than collapsed back onto one row per turn: the old
-- shape rebuilds itself from the log.
DELETE FROM comms_messages WHERE agent_session_message_id IS NOT NULL;

ALTER TABLE comms_messages
    RENAME CONSTRAINT comms_messages_content_or_message_check
        TO comms_messages_content_or_turn_check;

ALTER INDEX comms_messages_agent_session_message_unique
    RENAME TO comms_messages_agent_session_turn_unique;

ALTER TABLE comms_messages
    RENAME COLUMN agent_session_message_id TO agent_session_turn_id;
