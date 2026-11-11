-- Background runs of prompt suggestions: a hidden agent session of the person's,
-- billed as their agent usage, run when they start a background prompt suggestion
-- from the app. Nobody watches it, so it never waits for an approval; what
-- it may send or post is limited where its credential is minted. How a run is going is read from
-- its session, never stored here. Deleting the suggestion deletes its runs; the
-- session stays, as the run's result.
-- The foreign key to "User" locks it until this file commits; don't queue
-- behind a long transaction holding it.
SET LOCAL lock_timeout = '5s';

CREATE TABLE suggestion_run (
    session_id uuid PRIMARY KEY,
    suggestion_id uuid NOT NULL REFERENCES suggestion_prompt (suggestion_id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    -- The agent it runs as, and its first prompt's action, to read the
    -- session's progress with.
    agent_id text NOT NULL,
    action_id uuid NOT NULL,
    started_at timestamptz NOT NULL,
    -- When a finished run was settled, and how: `finished` made the suggestion
    -- done with what it produced; `failed` left it for another try.
    settled_at timestamptz,
    outcome text CHECK (outcome IN ('finished', 'failed')),
    -- When the scheduler last read it: unsettled runs are checked in turn,
    -- least recently first, so none keeps it from the others.
    checked_at timestamptz,
    CHECK ((settled_at IS NULL) = (outcome IS NULL))
);

CREATE INDEX suggestion_run_idea_idx ON suggestion_run (suggestion_id, started_at DESC);
CREATE INDEX suggestion_run_unsettled_idx ON suggestion_run (checked_at NULLS FIRST, started_at)
    WHERE settled_at IS NULL;
-- A person's latest run of each suggestion, for the feed; and deleting a person.
CREATE INDEX suggestion_run_user_idx ON suggestion_run (user_id, suggestion_id, started_at DESC);
