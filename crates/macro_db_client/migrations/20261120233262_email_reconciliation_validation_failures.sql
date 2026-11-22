SET LOCAL lock_timeout = '5s';

-- This PR's singleton rollout journal has at most one row. Keep definite
-- corrupt-row failures separate from transient lock, timeout and retry history.
-- The default preserves an earlier worker through a rolling update.
ALTER TABLE email_reconciliation_provider_backfill
    ADD COLUMN constraint_failures INTEGER NOT NULL DEFAULT 0
        CHECK (constraint_failures >= 0);
