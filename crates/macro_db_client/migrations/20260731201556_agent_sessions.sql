CREATE TYPE agent_session_status AS ENUM ('booting', 'ready', 'offline', 'failed');

CREATE TABLE agent_sessions (
    id                     UUID                 PRIMARY KEY,
    created_from_thread_id UUID                 REFERENCES comms_messages (id) ON DELETE SET NULL,
    thread_id              UUID                 NOT NULL
                               REFERENCES comms_messages (id) ON DELETE CASCADE,
    bot_id                 UUID                 NOT NULL REFERENCES bots (id),
    model                  TEXT                 NOT NULL,
    harness                TEXT                 NOT NULL,
    repo_url               TEXT                 NOT NULL,
    acp_session_id         TEXT,
    last_status            agent_session_status NOT NULL,
    created_at             TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    modified_at            TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_sessions_bot_created_from_thread
    ON agent_sessions (bot_id, created_from_thread_id);

CREATE INDEX agent_sessions_bot_thread
    ON agent_sessions (bot_id, thread_id);
