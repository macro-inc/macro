-- One workspace git repo per agent user, hosted by agent_git_service.
-- The bare repo lives on the service's volume; this row holds its credential.
-- agent_git_service deletes the volume directory before the row; the user
-- cascade only covers accounts deleted outside that path.
CREATE TABLE agent_repos (
    agent_user_id TEXT PRIMARY KEY REFERENCES "User" (id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    -- Hex SHA-256 of the repo token; the plaintext is returned once.
    token_hash TEXT NOT NULL,
    -- Size of the bare repo when last measured (before each push).
    size_bytes BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_push_at TIMESTAMPTZ
);
