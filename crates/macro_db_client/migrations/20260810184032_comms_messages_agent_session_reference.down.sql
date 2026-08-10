-- Placeholders are derived from agent_session_log, so the rows are dropped
-- rather than migrated back to some earlier shape: the old shape rebuilds
-- itself from the log.
DELETE FROM comms_messages WHERE agent_session_id IS NOT NULL;

DROP INDEX comms_messages_agent_session_message_unique;

ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_agent_session_fields_check,
    DROP CONSTRAINT comms_messages_content_or_session_check,
    DROP COLUMN agent_session_message_id,
    DROP COLUMN agent_session_author,
    DROP COLUMN agent_session_turn,
    DROP COLUMN agent_session_id,
    ALTER COLUMN content SET NOT NULL;
