-- Additive: the legacy memory table remains readable during rolling deployment.
CREATE TABLE memory_explicit (
    user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE memory_profile (
    user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    through_date DATE NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE memory_activity (
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    granularity TEXT NOT NULL CHECK (granularity IN ('day', 'week', 'month', 'summary')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL CHECK (period_end >= period_start),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, granularity, period_start)
);
CREATE INDEX memory_activity_granularity_idx ON memory_activity (granularity, period_start);
-- Record the teams associated with generation for provenance and team indexing.
-- Authorization uses current membership; this association is not an access rule.
CREATE TABLE memory_activity_team (
    user_id TEXT NOT NULL,
    granularity TEXT NOT NULL,
    period_start DATE NOT NULL,
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id, granularity, period_start),
    FOREIGN KEY (user_id, granularity, period_start)
        REFERENCES memory_activity(user_id, granularity, period_start) ON DELETE CASCADE
);
