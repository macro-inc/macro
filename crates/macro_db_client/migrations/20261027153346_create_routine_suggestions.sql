-- AI-picked routines offered to each user in the view sidebars, the Routines
-- page, and onboarding's last step. One row per user holds the latest
-- generated set; a generation claims the row before it runs, and keeps the
-- previous suggestions visible until its own result lands.
CREATE TABLE routine_suggestion_set (
    user_id text PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
    -- The generation that owns the row; a late result from an older one is
    -- discarded.
    generation_id uuid NOT NULL,
    suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- When the current generation started, so one whose process died can be
    -- claimed again.
    started_at timestamptz NOT NULL,
    generated_at timestamptz
);
