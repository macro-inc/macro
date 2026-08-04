-- Turn placeholders have NULL content, which the NOT NULL restore would
-- reject — clear them out (they are meaningless without the column anyway).
DELETE FROM comms_messages WHERE content IS NULL;

DROP INDEX comms_messages_agent_session_turn_unique;

ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_content_or_turn_check,
    DROP COLUMN agent_session_turn_id,
    ALTER COLUMN content SET NOT NULL;
