-- Every status Macro staff have set for the platform, newest last. The newest
-- row is the current status every user sees; the rest are its history.
CREATE TABLE system_status (
    id UUID PRIMARY KEY,
    status TEXT NOT NULL
        CHECK (status IN ('operational', 'degraded', 'major_outage')),
    -- Operational carries no message; the other statuses always explain
    -- themselves.
    message TEXT
        CHECK ((status = 'operational') = (message IS NULL)),
    -- The staff member who set it. Not a foreign key: the history outlives
    -- the accounts that wrote it.
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX system_status_created_at_idx ON system_status (created_at DESC);
