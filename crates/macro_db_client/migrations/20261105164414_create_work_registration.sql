-- An account registering an agent session as its work. Ending a registration keeps the row, so
-- history survives and a later turn cannot bring it back.
CREATE TYPE work_registration_end_reason AS ENUM (
    'unregistered',
    'pull_request_finished',
    'session_archived',
    'idle',
    'blocked_timeout'
);

CREATE TABLE work_registration (
    id UUID PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    agent_session_id UUID NOT NULL REFERENCES agent_session (id) ON DELETE CASCADE,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    end_reason work_registration_end_reason,
    CONSTRAINT work_registration_ended_with_reason
        CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

CREATE UNIQUE INDEX work_registration_active_account_session
    ON work_registration (account_id, agent_session_id)
    WHERE ended_at IS NULL;

CREATE INDEX work_registration_session ON work_registration (agent_session_id);
