-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- next_run_at changes on every release, and an index on it makes every release
-- a non-HOT update. The claim reads each account's rows through
-- calendar_outlook_work_account_generation instead.
DROP INDEX CONCURRENTLY IF EXISTS calendar_outlook_work_account_due;
