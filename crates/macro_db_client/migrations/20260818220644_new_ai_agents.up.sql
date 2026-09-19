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

-- One row per message exchanged on an agent session's logical protocol
-- stream (see agent_runtime_protocol::domain::schema::v0 and
-- agent_session::domain::model::{Message, AgentSessionLog}). direction +
-- content together round-trip the Message enum (ToServer/ToRuntime); user_id
-- is set only when the entry is ACP traffic that originated from a user.
CREATE TABLE agent_session_log (
    id                UUID        PRIMARY KEY,
    agent_session_id  UUID        NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    user_id           TEXT,
    direction         TEXT        NOT NULL CHECK (direction IN ('to_server', 'to_runtime')),
    content           JSONB       NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- list_by_session reads a session's log in chronological order.
CREATE INDEX agent_session_log_session_order
    ON agent_session_log (agent_session_id, created_at, id);

-- Whether a bot runs a sandboxed coding agent. Mentioning such a bot opens an
-- agent session (see agent_session) instead of a chat reply, so the trigger
-- path needs a database fact to tell agent bots apart from ordinary ones.
ALTER TABLE bots
    ADD COLUMN has_agent boolean NOT NULL DEFAULT false;

-- Seed the "Macro Coder" system bot (bot_id::MACRO_CODER_BOT_ID).
INSERT INTO bots (id, kind, name, handle, has_agent)
VALUES ('00000000-0000-0000-0000-00000000a9e7', 'system', 'Macro Coder', 'coder', true)
ON CONFLICT (id) DO NOTHING;
