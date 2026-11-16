SET LOCAL lock_timeout = '5s';

DELETE FROM suggestion_audience WHERE next_run_at IS NULL;
ALTER TABLE suggestion_audience
    ALTER COLUMN next_run_at SET NOT NULL,
    DROP COLUMN last_outcome,
    DROP COLUMN last_outcome_at,
    DROP COLUMN last_routines_ok_at;

DROP INDEX suggestion_generation_session_unfinished_idx;
UPDATE suggestion_generation_session
SET closed_at = coalesce(cleanup_at, ended_at, opened_at)
WHERE cleanup <> 'open' AND closed_at IS NULL;
ALTER TABLE suggestion_generation_session
    DROP COLUMN ending,
    DROP COLUMN ended_at,
    DROP COLUMN cleanup,
    DROP COLUMN cleanup_at,
    DROP COLUMN cleanup_attempts;

DROP INDEX suggestion_generation_user_trigger_idx;
DELETE FROM suggestion_generation WHERE trigger = 'manual';
DELETE FROM suggestion_generation WHERE trigger = 'onboarding' AND attempt > 1;
UPDATE suggestion_generation SET status = 'ready' WHERE status = 'partial';
UPDATE suggestion_generation SET status = 'failed' WHERE status IN ('cancelled', 'interrupted');
DROP INDEX suggestion_generation_onboarding_idx;
CREATE UNIQUE INDEX suggestion_generation_onboarding_idx
    ON suggestion_generation (user_id) WHERE trigger = 'onboarding';
ALTER TABLE suggestion_generation
    DROP CONSTRAINT suggestion_generation_status_check,
    DROP CONSTRAINT suggestion_generation_trigger_check,
    ADD CONSTRAINT suggestion_generation_status_check
        CHECK (status IN ('generating', 'ready', 'failed')),
    ADD CONSTRAINT suggestion_generation_trigger_check
        CHECK (trigger IN ('onboarding', 'nightly')),
    DROP COLUMN attempt,
    DROP COLUMN heartbeat_at;
