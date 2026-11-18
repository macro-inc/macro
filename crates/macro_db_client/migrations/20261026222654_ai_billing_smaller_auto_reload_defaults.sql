-- Automatic reload starts smaller: reload below $5 back up to $25. Matches
-- AUTO_RELOAD_DEFAULT_MINIMUM_CENTS and AUTO_RELOAD_DEFAULT_TARGET_CENTS.
-- Existing rows keep their values; clients start an off Auto-Reload from the
-- plan catalog's defaults, and enabling always saves explicit thresholds.
SET LOCAL lock_timeout = '5s';

ALTER TABLE ai_billing_account
    ALTER COLUMN auto_reload_minimum_cents SET DEFAULT 500,
    ALTER COLUMN auto_reload_target_cents SET DEFAULT 2500;
