-- Symmetric with the up migration: placeholders are re-derived from the
-- session log, so they are dropped rather than rewritten back onto the
-- denormalized columns.
DELETE FROM comms_messages WHERE agent_session_message_identifier_id IS NOT NULL;

DROP INDEX comms_messages_agent_session_message_identifier_unique;

ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_content_or_session_check,
    DROP COLUMN agent_session_message_identifier_id,
    ADD COLUMN agent_session_id UUID,
    ADD COLUMN agent_session_turn BIGINT,
    ADD COLUMN agent_session_author TEXT,
    -- Generated, as it was before: the composite is derived from the three
    -- typed columns rather than written.
    ADD COLUMN agent_session_message_id TEXT
        GENERATED ALWAYS AS (
            CASE WHEN agent_session_id IS NOT NULL THEN
                agent_session_id::text || ':' || agent_session_turn || ':' || agent_session_author
            END
        ) STORED,
    ADD CONSTRAINT comms_messages_content_or_session_check
        CHECK (num_nonnulls(content, agent_session_id) >= 1),
    ADD CONSTRAINT comms_messages_agent_session_fields_check
        CHECK (
            (agent_session_id IS NULL) = (agent_session_turn IS NULL) AND
            (agent_session_id IS NULL) = (agent_session_author IS NULL)
        ),
    ADD CONSTRAINT comms_messages_agent_session_author_check
        CHECK (agent_session_author IN ('user', 'agent'));

CREATE UNIQUE INDEX comms_messages_agent_session_message_unique
    ON comms_messages (agent_session_id, agent_session_turn, agent_session_author)
    WHERE agent_session_id IS NOT NULL;

DROP TABLE agent_session_message_identifier;
