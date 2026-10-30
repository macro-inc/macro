-- Whether a user's agent sessions archive themselves once their work is done. A missing row is
-- every trigger off.
CREATE TABLE user_agent_session_auto_archive (
    user_id                TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
    on_pull_request_merged BOOLEAN NOT NULL DEFAULT false,
    on_runtime_closed      BOOLEAN NOT NULL DEFAULT false,
    modified_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One session's choices over its owner's defaults. NULL follows the owner.
CREATE TABLE agent_session_auto_archive_override (
    agent_session_id       UUID PRIMARY KEY REFERENCES agent_session (id) ON DELETE CASCADE,
    on_pull_request_merged BOOLEAN,
    on_runtime_closed      BOOLEAN,
    modified_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The one time a session archived itself, and why. Kept when a person restores the session, so
-- no later trigger archives it again.
CREATE TABLE agent_session_auto_archive (
    agent_session_id UUID PRIMARY KEY REFERENCES agent_session (id) ON DELETE CASCADE,
    reason           TEXT NOT NULL CHECK (reason IN ('pull_request_merged', 'runtime_closed')),
    archived_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
