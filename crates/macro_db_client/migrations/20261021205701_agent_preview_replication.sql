-- Separate from agent-session management: these rows own preview SSH transports.
CREATE TABLE agent_preview_replica (
    id UUID PRIMARY KEY,
    address TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE agent_preview_lease (
    id TEXT PRIMARY KEY,
    session_id UUID NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    metadata JSONB NOT NULL,
    replica_id UUID REFERENCES agent_preview_replica(id),
    status TEXT NOT NULL CHECK (status IN ('starting', 'ready', 'offline', 'expired', 'stopped')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX agent_preview_lease_user_id ON agent_preview_lease(user_id);
CREATE INDEX agent_preview_lease_replica_id ON agent_preview_lease(replica_id);
CREATE INDEX agent_preview_lease_expires_at ON agent_preview_lease(expires_at);
CREATE TABLE agent_preview_credential (
    hash BYTEA PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('ssh', 'ticket', 'browser')),
    preview_id TEXT NOT NULL REFERENCES agent_preview_lease(id) ON DELETE CASCADE,
    user_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX agent_preview_credential_preview_id ON agent_preview_credential(preview_id);
CREATE INDEX agent_preview_credential_expires_at ON agent_preview_credential(expires_at);
CREATE TABLE agent_preview_watcher (
    session_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (session_id, user_id)
);
CREATE INDEX agent_preview_watcher_expires_at ON agent_preview_watcher(expires_at);
