-- Routines AI suggests for each person once their inbox connects, shown in
-- the view sidebars, on the Routines page and in onboarding's last step.

-- The person's one generation: it runs once, when their inbox connects.
CREATE TABLE routine_suggestion_generation (
    user_id text PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
    started_at timestamptz NOT NULL,
    finished_at timestamptz
);

-- A hidden agent session suggesting for some of the person's surfaces.
-- Only a session with an open row may hand back suggestions; the row is
-- closed when the session is stopped, and the sweep deletes the sessions of
-- rows left open by a process that stopped.
CREATE TABLE routine_suggestion_session (
    session_id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    agent_id text NOT NULL,
    surfaces text[] NOT NULL,
    opened_at timestamptz NOT NULL,
    closed_at timestamptz
);

CREATE INDEX routine_suggestion_session_open_idx ON routine_suggestion_session (opened_at)
    WHERE closed_at IS NULL;

-- One suggestion a session handed back: a catalog routine with knob values,
-- or a drafted routine that passed saving's checks, kept switched off.
-- Dismissed ones stay so they aren't suggested again.
CREATE TABLE routine_suggestion (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    session_id uuid NOT NULL,
    surfaces text[] NOT NULL,
    catalog_key text,
    knob_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    routine jsonb,
    reason text NOT NULL,
    keep_probability real NOT NULL,
    dismissed_at timestamptz,
    created_at timestamptz NOT NULL,
    CHECK ((catalog_key IS NULL) <> (routine IS NULL))
);

CREATE INDEX routine_suggestion_user_idx ON routine_suggestion (user_id);

-- Catalog routines the person dismissed as Macro's templates.
CREATE TABLE routine_suggestion_dismissed_template (
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    catalog_key text NOT NULL,
    dismissed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, catalog_key)
);

-- The suggestion a routine was saved from: a plain pointer, like
-- template_id, so the routine keeps it after the suggestion goes.
-- Nullable without a default, so adding it rewrites nothing.
ALTER TABLE scheduled_action ADD COLUMN suggestion_id uuid;
