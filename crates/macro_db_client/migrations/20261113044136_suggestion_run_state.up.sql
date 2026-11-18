-- A background run's state lives on its row, so reading the feed never asks a
-- session how a run is going; `crates/suggestions/src/domain/run.rs` is its
-- state machine. Its `state` replaces `outcome`: a settled state says how the
-- run settled.
SET LOCAL lock_timeout = '5s';

ALTER TABLE suggestion_run
    ADD COLUMN state text NOT NULL DEFAULT 'starting',
    -- When the run entered its state: a waiting run is given up a while
    -- after it began waiting, a stopped one deleted a while after its stop.
    ADD COLUMN state_changed_at timestamptz,
    -- What the run may send or post: the suggestion's `sends` when it started,
    -- which the person approved by running it.
    ADD COLUMN sends text,
    -- Until when one process holds the run to act on it (read its session,
    -- stop or delete it, settle it); the others leave it alone until then.
    ADD COLUMN claimed_until timestamptz;

UPDATE suggestion_run
SET state = COALESCE(outcome, 'running'),
    state_changed_at = COALESCE(settled_at, started_at);

UPDATE suggestion_run r
SET sends = p.sends
FROM suggestion_prompt p
WHERE p.suggestion_id = r.suggestion_id;

ALTER TABLE suggestion_run
    DROP COLUMN outcome,
    ALTER COLUMN state DROP DEFAULT,
    ALTER COLUMN state_changed_at SET NOT NULL,
    ADD CONSTRAINT suggestion_run_state_check CHECK (state IN (
        'starting', 'running', 'waiting', 'stopping', 'cancelling',
        'finished', 'failed', 'cancelled'
    )),
    ADD CONSTRAINT suggestion_run_settled_check CHECK (
        (settled_at IS NOT NULL) = (state IN ('finished', 'failed', 'cancelled'))
    );

-- A suggestion has at most one unsettled run: none starts while another goes.
CREATE UNIQUE INDEX suggestion_run_one_unsettled_idx ON suggestion_run (suggestion_id)
    WHERE settled_at IS NULL;
