-- Onboarding flow state: one row per user. The import pipeline
-- (import_entity / import_run) carries all connector work; this row only
-- tracks whether the user is still in the /setup flow.

CREATE TABLE user_onboarding (
    user_id      TEXT PRIMARY KEY,
    status       TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'completed'
    skipped      BOOLEAN NOT NULL DEFAULT FALSE,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'completed'))
);
