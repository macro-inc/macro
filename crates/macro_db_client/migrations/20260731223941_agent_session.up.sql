-- An AI coding agent session: one row per agent run, tracking its owner, the
-- container runtime it drives, the ACP session id it negotiated, and the comms
-- message that invoked it when one exists. A session does not own a channel.
-- status/status_event_name mirror agent_session::domain::model::SessionStatus:
-- 'no_messages' until the first system event arrives, 'event' with the wire
-- event name once one has, or 'disconnected' if the connection dropped
-- without a clean close.
CREATE TABLE agent_session (
    id                     UUID        PRIMARY KEY,
    owner_id               TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    thread_id              UUID        REFERENCES comms_messages(id) ON DELETE SET NULL,
    originating_message_id UUID        REFERENCES comms_messages(id) ON DELETE SET NULL,
    bot_id                 UUID        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    model                  TEXT        NOT NULL,
    harness                TEXT        NOT NULL,
    repo_url               TEXT        NOT NULL,
    acp_session_id         TEXT,
    status                 TEXT        NOT NULL DEFAULT 'no_messages'
                                       CHECK (status IN ('no_messages', 'event', 'disconnected')),
    status_event_name      TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_session_status_event_name_check CHECK (
        (status = 'event') = (status_event_name IS NOT NULL)
    )
);

CREATE INDEX agent_session_bot_id_idx ON agent_session (bot_id);
CREATE UNIQUE INDEX agent_session_thread_bot_unique
    ON agent_session (thread_id, bot_id)
    WHERE thread_id IS NOT NULL;
