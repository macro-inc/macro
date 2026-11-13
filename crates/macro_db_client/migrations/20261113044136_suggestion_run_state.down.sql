SET LOCAL lock_timeout = '5s';

DROP INDEX suggestion_run_one_unsettled_idx;

ALTER TABLE suggestion_run ADD COLUMN outcome text CHECK (outcome IN ('finished', 'failed'));

UPDATE suggestion_run
SET outcome = CASE
    WHEN state = 'finished' THEN 'finished'
    WHEN settled_at IS NOT NULL THEN 'failed'
END;

ALTER TABLE suggestion_run
    ADD CHECK ((settled_at IS NULL) = (outcome IS NULL)),
    DROP COLUMN claimed_until,
    DROP COLUMN sends,
    DROP COLUMN state_changed_at,
    DROP COLUMN state;
