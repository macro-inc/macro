-- Agent turns render in channels as ordinary comms messages whose content is
-- not stored: the row is a placeholder carrying a reference to a folded
-- agent-session message, and the body is folded from agent_session_log on
-- read (see agent_session::domain).
--
-- The reference is three typed columns - session, turn, author - rather than
-- one composite string. agent_session's own read and write path
-- (PgAgentSessionRepo, outbound/postgres/mod.rs) used to build and parse a
-- "{session}:{turn}:{author}" string to get at these; with real columns it
-- never has to. No FK to agent_session: a dangling reference after session
-- deletion is a harmless lookup miss, not something worth cascading.
--
-- agent_session_message_id stays as a generated column in that same
-- "{session}:{turn}:{author}" shape - agent_fold::domain::model's
-- composite_message_id already produces it - so every reader downstream of
-- this table that only ever treated it as an opaque wire id (the channels
-- API, the frontend, the wasm fold) keeps matching against the exact same
-- string with no changes of its own.
ALTER TABLE comms_messages
    ALTER COLUMN content DROP NOT NULL,
    ADD COLUMN agent_session_id UUID,
    ADD COLUMN agent_session_turn BIGINT,
    ADD COLUMN agent_session_author TEXT
        CHECK (agent_session_author IN ('user', 'agent')),
    ADD COLUMN agent_session_message_id TEXT
        GENERATED ALWAYS AS (
            CASE WHEN agent_session_id IS NOT NULL THEN
                agent_session_id::text || ':' || agent_session_turn || ':' || agent_session_author
            END
        ) STORED;

-- A message stores its content, points at a folded agent-session message, or
-- both - never neither. And the three reference columns are all-or-nothing:
-- there is no such thing as a turn or author without the session they belong
-- to.
ALTER TABLE comms_messages
    ADD CONSTRAINT comms_messages_content_or_session_check
        CHECK (num_nonnulls(content, agent_session_id) >= 1),
    ADD CONSTRAINT comms_messages_agent_session_fields_check
        CHECK (
            (agent_session_id IS NULL) = (agent_session_turn IS NULL) AND
            (agent_session_id IS NULL) = (agent_session_author IS NULL)
        );

-- One placeholder per folded message: appends refold the session and diff
-- against existing placeholders, so this backstops that diff against
-- double-writes.
CREATE UNIQUE INDEX comms_messages_agent_session_message_unique
    ON comms_messages (agent_session_id, agent_session_turn, agent_session_author)
    WHERE agent_session_id IS NOT NULL;
