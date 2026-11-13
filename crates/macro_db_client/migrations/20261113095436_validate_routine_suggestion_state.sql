-- Validate the state check added NOT VALID in 20261113042516, in its own
-- transaction so the backfill's row locks aren't held through the scan. It
-- takes a SHARE UPDATE EXCLUSIVE lock: reads and writes go on meanwhile.
SET LOCAL lock_timeout = '5s';

ALTER TABLE routine_suggestion VALIDATE CONSTRAINT routine_suggestion_state_check;
