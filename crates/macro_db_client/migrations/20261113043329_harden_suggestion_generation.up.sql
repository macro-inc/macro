-- Generations, their sessions and the nightly audience store their states, so
-- every step is checked against the state it leaves and nobody infers a state
-- from timestamps. The tables are small: a generation and a few sessions per
-- person per night.
SET LOCAL lock_timeout = '5s';

-- A generation ends ready, partial, failed, cancelled (its process stopped
-- it) or interrupted (its heartbeat stopped; the sweep marks it). Cancelled and
-- interrupted ones may start again as the next attempt, with a new id.
ALTER TABLE suggestion_generation
    DROP CONSTRAINT suggestion_generation_status_check,
    DROP CONSTRAINT suggestion_generation_trigger_check,
    ADD CONSTRAINT suggestion_generation_status_check
        CHECK (status IN ('generating', 'ready', 'partial', 'failed', 'cancelled', 'interrupted')),
    ADD CONSTRAINT suggestion_generation_trigger_check
        CHECK (trigger IN ('onboarding', 'nightly', 'manual')),
    ADD COLUMN attempt smallint NOT NULL DEFAULT 1
        CONSTRAINT suggestion_generation_attempt_check CHECK (attempt >= 1),
    ADD COLUMN heartbeat_at timestamptz NOT NULL DEFAULT now();

-- Onboarding runs once, but a cut-short attempt may be followed by the next.
DROP INDEX suggestion_generation_onboarding_idx;
CREATE UNIQUE INDEX suggestion_generation_onboarding_idx
    ON suggestion_generation (user_id, attempt) WHERE trigger = 'onboarding';

-- A person's latest generation of one trigger: whether the next may start,
-- and when they may next ask for fresh suggestions.
CREATE INDEX suggestion_generation_user_trigger_idx
    ON suggestion_generation (user_id, trigger, started_at DESC);

-- A session's ending, and how far its cleanup got: open (its tools work),
-- stopping (ended; its tools refuse and it is being deleted), deleted, or
-- abandoned (deleting kept failing).
ALTER TABLE suggestion_generation_session
    ADD COLUMN ending text CONSTRAINT suggestion_generation_session_ending_check
        CHECK (ending IN ('finished', 'failed', 'timed_out', 'delivery_unknown', 'cancelled', 'interrupted')),
    ADD COLUMN ended_at timestamptz,
    ADD COLUMN cleanup text NOT NULL DEFAULT 'open' CONSTRAINT suggestion_generation_session_cleanup_check
        CHECK (cleanup IN ('open', 'stopping', 'deleted', 'abandoned')),
    ADD COLUMN cleanup_at timestamptz,
    ADD COLUMN cleanup_attempts smallint NOT NULL DEFAULT 0
        CONSTRAINT suggestion_generation_session_cleanup_attempts_check CHECK (cleanup_attempts >= 0);

-- How a closed session ended wasn't kept; it was cleaned up as if finished.
UPDATE suggestion_generation_session
SET cleanup = 'deleted', cleanup_at = closed_at, ended_at = closed_at, ending = 'finished'
WHERE closed_at IS NOT NULL;

-- A session leaves open only with its ending.
ALTER TABLE suggestion_generation_session
    ADD CONSTRAINT suggestion_generation_session_ended_check
        CHECK ((cleanup = 'open') = (ending IS NULL AND ended_at IS NULL));

-- `closed_at` and its index stay while the previous release may run: it
-- tells open sessions by a NULL `closed_at`, so a session leaving open still
-- sets it. A later change stops writing it, then drops it.

-- The sweep reads only sessions still running or being cleaned up.
CREATE INDEX suggestion_generation_session_unfinished_idx
    ON suggestion_generation_session (opened_at) WHERE cleanup IN ('open', 'stopping');

-- Out of the nightly rotation is a NULL next run, not a deleted row: the row
-- keeps the person's routines cadence and the last nightly outcome.
ALTER TABLE suggestion_audience
    ALTER COLUMN next_run_at DROP NOT NULL,
    ADD COLUMN last_outcome text CONSTRAINT suggestion_audience_last_outcome_check
        CHECK (last_outcome IN ('started', 'skipped', 'missed', 'retrying', 'cut_short', 'dropped')),
    ADD COLUMN last_outcome_at timestamptz,
    ADD COLUMN last_routines_ok_at timestamptz;
