-- Pull requests associated with agent sessions: the one a session's agent opened, and any a
-- person linked afterwards. Keyed by the pull request's owner/repo/pull/number key, the key its
-- foreign entity records and github_pull_request row are stored under.
CREATE TABLE agent_session_pull_request (
    agent_session_id UUID NOT NULL REFERENCES agent_session (id) ON DELETE CASCADE,
    github_key       TEXT NOT NULL,
    source           TEXT NOT NULL CHECK (source IN ('agent', 'user')),
    -- The Macro user who linked it, for links a person made.
    linked_by        TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_session_id, github_key)
);

CREATE INDEX idx_agent_session_pull_request_github_key
    ON agent_session_pull_request (lower(github_key));

-- Sessions already carry the pull request their agent opened.
INSERT INTO agent_session_pull_request (agent_session_id, github_key, source)
SELECT s.id, link.github_key, 'agent'
FROM agent_session s
CROSS JOIN LATERAL (
    SELECT substring(s.pull_request_url FROM '^https://github\.com/(.+)$') AS github_key
) link
WHERE link.github_key IS NOT NULL
ON CONFLICT DO NOTHING;
