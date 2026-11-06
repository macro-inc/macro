-- Routines AI picks for each person from the routine catalog, shown in the
-- view sidebars, on the Routines page and in onboarding's last step.

-- The person's last generation. A generation claims the row before it runs;
-- a late result from one that no longer owns it is discarded.
CREATE TABLE routine_suggestion_generation (
    user_id text PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
    generation_id uuid NOT NULL,
    -- A fingerprint of what the last finished generation read (inboxes,
    -- tools, routines), to regenerate when it changes.
    inputs text,
    started_at timestamptz NOT NULL,
    generated_at timestamptz
);

-- One suggestion: a catalog routine with knob values AI filled in, or a
-- request the drafter writes when the person accepts it. Open suggestions
-- are replaced by each generation; dismissed ones stay so they aren't
-- suggested again. Both go with the person.
CREATE TABLE routine_suggestion (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    generation_id uuid NOT NULL,
    -- Best first within a generation.
    position smallint NOT NULL,
    surface text NOT NULL,
    catalog_key text,
    knob_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    title text,
    request text,
    reason text NOT NULL,
    keep_probability real NOT NULL,
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'dismissed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (catalog_key IS NOT NULL AND title IS NULL AND request IS NULL)
        OR (catalog_key IS NULL AND title IS NOT NULL AND request IS NOT NULL)
    )
);

CREATE INDEX routine_suggestion_user_state_idx ON routine_suggestion (user_id, state);

-- The suggestion a routine was saved from: a plain pointer, like
-- template_id, so the routine keeps it after the suggestion is replaced.
-- Nullable without a default, so adding it rewrites nothing.
ALTER TABLE scheduled_action ADD COLUMN suggestion_id uuid;
