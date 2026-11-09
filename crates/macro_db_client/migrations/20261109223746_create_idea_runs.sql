-- Background runs of prompt ideas: a hidden agent session of the person's,
-- with the full toolset and approvals on, billed as their agent usage, run
-- when they accept a background prompt idea. How a run is going is read from
-- its session, never stored here. Deleting the idea deletes its runs; the
-- session stays, as the run's result.
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
    CHECK ((settled_at IS NULL) = (outcome IS NULL))
);

CREATE INDEX idea_run_idea_idx ON idea_run (idea_id, started_at DESC);
CREATE INDEX idea_run_unsettled_idx ON idea_run (started_at) WHERE settled_at IS NULL;
