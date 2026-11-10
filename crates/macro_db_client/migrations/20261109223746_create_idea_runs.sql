-- Background runs of prompt ideas: a hidden agent session of the person's,
-- billed as their agent usage, run when they start a background prompt idea
-- from the app. Nobody watches it, so it never waits for an approval; what
-- it may send or post is limited where its credential is minted. How a run is going is read from
-- its session, never stored here. Deleting the idea deletes its runs; the
-- session stays, as the run's result.
-- The foreign key to "User" locks it until this file commits; don't queue
-- behind a long transaction holding it.
SET LOCAL lock_timeout = '5s';

CREATE TABLE idea_run (
    session_id uuid PRIMARY KEY,
    idea_id uuid NOT NULL REFERENCES idea_prompt (idea_id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    -- The agent it runs as, and its first prompt's action, to read the
    -- session's progress with.
    agent_id text NOT NULL,
    action_id uuid NOT NULL,
    started_at timestamptz NOT NULL,
    -- When a finished run was settled, and how: `finished` made the idea
    -- done with what it produced; `failed` left it for another try.
    settled_at timestamptz,
    outcome text CHECK (outcome IN ('finished', 'failed')),
    -- When the scheduler last read it: unsettled runs are checked in turn,
    -- least recently first, so none keeps it from the others.
    checked_at timestamptz,
    CHECK ((settled_at IS NULL) = (outcome IS NULL))
);

CREATE INDEX idea_run_idea_idx ON idea_run (idea_id, started_at DESC);
CREATE INDEX idea_run_unsettled_idx ON idea_run (checked_at NULLS FIRST, started_at)
    WHERE settled_at IS NULL;
-- A person's latest run of each idea, for the feed; and deleting a person.
CREATE INDEX idea_run_user_idx ON idea_run (user_id, idea_id, started_at DESC);
