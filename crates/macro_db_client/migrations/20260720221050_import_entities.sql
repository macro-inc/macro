-- Import pipeline ledger: rows are staged by gather jobs / chat, flipped to
-- imported by the import job. Unlike foreign_entity (live references to items
-- that stay external), import_entity tracks items being COPIED into Macro.

CREATE TABLE import_entity (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,
    -- Set when the created entity is shared with a team (e.g. channels);
    -- imported rows with a team_id dedupe team-wide.
    team_id     UUID REFERENCES team (id) ON DELETE SET NULL,
    source      TEXT NOT NULL,  -- 'linear' | 'notion' | 'slack'
    foreign_id  TEXT NOT NULL,  -- stable id in the source system
    status      TEXT NOT NULL DEFAULT 'staged',  -- 'staged' | 'importing' | 'imported' | 'discarded'
    initiator   TEXT NOT NULL,  -- 'onboarding' | 'chat' (provenance, not visibility)
    metadata    JSONB NOT NULL DEFAULT '{}',
    entity_id   TEXT,           -- Macro entity once imported
    entity_type TEXT,           -- 'task' | 'md' | 'channel'
    last_error  TEXT,           -- failure detail from the last import attempt
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, source, foreign_id),
    CHECK (status <> 'imported' OR entity_id IS NOT NULL),
    CHECK (source IN ('linear', 'notion', 'slack')),
    CHECK (status IN ('staged', 'importing', 'imported', 'discarded')),
    CHECK (initiator IN ('onboarding', 'chat'))
);

-- Team-wide dedup lookup: "has anyone on my team already imported this?"
CREATE INDEX import_entity_team_imported_idx
    ON import_entity (team_id, source, foreign_id)
    WHERE team_id IS NOT NULL AND status = 'imported';

-- Gather-job state per (user, connector): drives the shimmer / failed / retry
-- states in the UI and CASes so only one gather runs per connection.
CREATE TABLE import_run (
    user_id    TEXT NOT NULL,
    source     TEXT NOT NULL,
    status     TEXT NOT NULL,  -- 'running' | 'ready' | 'failed' | 'dismissed'
    error      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, source),
    CHECK (source IN ('linear', 'notion', 'slack')),
    CHECK (status IN ('running', 'ready', 'failed', 'dismissed'))
);
