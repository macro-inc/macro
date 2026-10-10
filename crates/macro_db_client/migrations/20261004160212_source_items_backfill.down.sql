-- Intentionally a no-op: once the triggers run, backfilled rows are indistinguishable from rows
-- they wrote, and reverting 20261004160211 drops the table.
SELECT 1;
