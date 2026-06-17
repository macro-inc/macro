CREATE TABLE ai_projection_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    projection_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    prompt TEXT NOT NULL,
    context TEXT,
    schema JSONB,
    generation_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    refresh_cadence TEXT NOT NULL,
    expiry TEXT NOT NULL DEFAULT 'day',
    status TEXT NOT NULL DEFAULT 'cold',
    output TEXT,
    error TEXT,
    generated_at TIMESTAMPTZ,
    stale_at TIMESTAMPTZ,
    next_refresh_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    last_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ai_projection_instances_target_type_check
        CHECK (target_type IN ('user', 'team')),
    CONSTRAINT ai_projection_instances_refresh_cadence_check
        CHECK (refresh_cadence IN ('high', 'medium', 'low')),
    CONSTRAINT ai_projection_instances_expiry_check
        CHECK (expiry IN ('day', 'week', 'month')),
    CONSTRAINT ai_projection_instances_status_check
        CHECK (status IN ('cold', 'ready', 'refreshing', 'error'))
);

CREATE UNIQUE INDEX ai_projection_instances_cache_key_idx
    ON ai_projection_instances (projection_id, target_type, target_id, prompt_hash);

CREATE INDEX ai_projection_instances_due_refresh_idx
    ON ai_projection_instances (next_refresh_at, claimed_at, last_requested_at);

CREATE INDEX ai_projection_instances_target_idx
    ON ai_projection_instances (target_type, target_id, projection_id);

CREATE INDEX ai_projection_instances_expiry_cleanup_idx
    ON ai_projection_instances (expiry, last_requested_at);
