-- no-transaction
-- Keep CALL as the only statement: each 500-assignment batch commits independently.
CALL backfill_task_dependency_edges();
