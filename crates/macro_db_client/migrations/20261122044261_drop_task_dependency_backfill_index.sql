-- no-transaction
-- The backfill procedure is gone; keep its cursor index off steady-state writes.
DROP INDEX CONCURRENTLY IF EXISTS task_dependency_backfill_source;
