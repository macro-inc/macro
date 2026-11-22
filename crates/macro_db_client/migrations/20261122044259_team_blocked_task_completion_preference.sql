-- Additive, constant-default metadata change; fail fast instead of queueing writers.
SET LOCAL lock_timeout = '2s';
ALTER TABLE team ADD COLUMN prevent_completing_blocked_tasks BOOLEAN NOT NULL DEFAULT FALSE;

DROP PROCEDURE backfill_task_dependency_edges();
