DELETE FROM comms_channels
WHERE kind = 'agent';

DROP TABLE agent_session_log;
DROP TABLE agent_session;

ALTER TABLE comms_channels
    DROP COLUMN kind;

CREATE TABLE agent_session (
    id                     UUID        PRIMARY KEY,
    created_from_thread_id UUID,
    thread_id              UUID        NOT NULL,
    bot_id                 UUID        NOT NULL
                                       REFERENCES bots(id) ON DELETE CASCADE,
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

CREATE INDEX agent_session_bot_id_idx
    ON agent_session (bot_id);

CREATE INDEX agent_session_thread_id_idx
    ON agent_session (thread_id);

CREATE TABLE agent_session_log (
    id               UUID        PRIMARY KEY,
    agent_session_id UUID        NOT NULL
                                 REFERENCES agent_session(id) ON DELETE CASCADE,
    user_id          TEXT,
    direction        TEXT        NOT NULL
                                 CHECK (direction IN ('to_server', 'to_runtime')),
    content          JSONB       NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agent_session_log_session_order
    ON agent_session_log (agent_session_id, created_at, id);
