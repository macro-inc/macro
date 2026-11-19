-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- No query reads work in global next_run_at order since the claim went per
-- account, and the index makes every release a non-HOT update.
DROP INDEX CONCURRENTLY IF EXISTS calendar_outlook_work_due;
