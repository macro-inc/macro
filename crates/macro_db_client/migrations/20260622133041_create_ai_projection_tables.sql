-- High-level AI projection definitions, keyed by a frontend-defined text id
-- (e.g. `notification_important_widget`). `target_type` declares whether the
-- projection is materialized per user or per team.
CREATE TABLE ai_projection (
    id              TEXT        NOT NULL,
    prompt          TEXT        NOT NULL,
    prompt_hash     TEXT        NOT NULL,
    target_type     TEXT        NOT NULL,
    refresh_cadence TEXT        NOT NULL,
    expiry          TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ai_projection_pkey PRIMARY KEY (id),
    CONSTRAINT ai_projection_target_type_check CHECK (target_type IN ('user', 'team')),
    CONSTRAINT ai_projection_refresh_cadence_check CHECK (refresh_cadence IN ('high', 'medium', 'low')),
    CONSTRAINT ai_projection_expiry_check CHECK (expiry IN ('day', 'week', 'month'))
);

-- Per-target cached instances of an AI projection. `target_id` holds either a
-- user id or a team id, interpreted via the parent projection's `target_type`.
-- Keyed by (target_id, ai_projection_id) so a projection is cached, refreshed,
-- and expired independently per target and is directly addressable without a
-- surrogate id. `prompt_hash` records the projection's prompt version at
-- materialization time (the definition's prompt is immutable, so it is not part
-- of the key).
CREATE TABLE user_ai_projection (
    ai_projection_id  TEXT        NOT NULL REFERENCES ai_projection (id) ON DELETE CASCADE,
    target_id         TEXT        NOT NULL,
    prompt_hash       TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'cold',
    result            TEXT,
    error             TEXT,
    generated_at      TIMESTAMPTZ,
    stale_at          TIMESTAMPTZ,
    last_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_ai_projection_pkey PRIMARY KEY (target_id, ai_projection_id),
    CONSTRAINT user_ai_projection_status_check
        CHECK (status IN ('loading', 'cold', 'ready', 'refreshing', 'error'))
);

CREATE INDEX user_ai_projection_projection_idx ON user_ai_projection (ai_projection_id);
