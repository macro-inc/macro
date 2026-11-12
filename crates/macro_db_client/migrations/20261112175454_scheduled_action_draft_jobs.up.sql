-- Routine drafts that run in the background: the person starts one, leaves, and
-- opens its result later. A job's row outlives its drafter and holds its state,
-- what was asked (the request kind and the person's words), its progress and,
-- once finished, its result. A row whose state is NULL is a blocking draft,
-- deleted when its request returns, as before.
--
-- The table holds only drafts in progress or waiting to be opened, so it stays
-- small; the sweep deletes finished jobs after a retention.
SET LOCAL lock_timeout = '5s';

ALTER TABLE scheduled_action_draft
    ADD COLUMN state TEXT
        CONSTRAINT scheduled_action_draft_state_check
        CHECK (state IN ('drafting', 'ready', 'failed', 'cancelled')),
    -- What was asked: {kind, description}.
    ADD COLUMN request JSONB,
    -- The latest milestone and what it found, for a reload to show.
    ADD COLUMN progress JSONB,
    -- The draft (a routine, a step, or why it failed), once finished.
    ADD COLUMN result JSONB,
    ADD COLUMN finished_at TIMESTAMPTZ,
    -- The W3C trace context of the request that started the job.
    ADD COLUMN traceparent TEXT,
    -- The id the client gave the start, so a start sent again (as a client
    -- does when its connection drops) finds the job instead of starting
    -- another.
    ADD COLUMN client_id UUID;

-- A person's jobs, newest first. Blocking drafts (state NULL) aren't listed.
CREATE INDEX scheduled_action_draft_owner_jobs
    ON scheduled_action_draft (owner_id, created_at DESC)
    WHERE state IS NOT NULL;

-- One live job per start a person sends. A cancelled job frees its id.
CREATE UNIQUE INDEX scheduled_action_draft_owner_client
    ON scheduled_action_draft (owner_id, client_id)
    WHERE state IN ('drafting', 'ready', 'failed');
