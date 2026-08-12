DELETE FROM comms_messages WHERE agent_session_id IS NOT NULL;

ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_content_or_session_check,
    DROP CONSTRAINT comms_messages_agent_session_fields_check;

DROP INDEX comms_messages_agent_session_message_unique;

-- This is the virtual "fold id" that represents a turn in an ACP session
CREATE TABLE agent_session_message_identifier (
    id UUID PRIMARY KEY,
    agent_session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    turn BIGINT NOT NULL CHECK (turn >= 0),
    author TEXT NOT NULL CHECK (author IN ('user', 'agent')),
    CONSTRAINT agent_session_message_identifier_unique
        UNIQUE (agent_session_id, turn, author)
);

ALTER TABLE comms_messages
    DROP COLUMN agent_session_message_id,
    DROP COLUMN agent_session_author,
    DROP COLUMN agent_session_turn,
    DROP COLUMN agent_session_id,
    ADD COLUMN agent_session_message_identifier_id UUID
        REFERENCES agent_session_message_identifier (id) ON DELETE CASCADE,
    ADD CONSTRAINT comms_messages_content_or_session_check
        CHECK (num_nonnulls(content, agent_session_message_identifier_id) >= 1);

CREATE UNIQUE INDEX comms_messages_agent_session_message_identifier_unique
    ON comms_messages (agent_session_message_identifier_id)
    WHERE agent_session_message_identifier_id IS NOT NULL;
