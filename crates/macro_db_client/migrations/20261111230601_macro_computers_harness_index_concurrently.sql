-- no-transaction
-- One live harness per Macro computer. Built CONCURRENTLY so harness writes
-- continue. IF NOT EXISTS does not repair an INVALID index left by an
-- interrupted build: check `SELECT indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('harnesses_computer_id_uq')`, and if false run
-- `DROP INDEX CONCURRENTLY harnesses_computer_id_uq` before retrying.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS harnesses_computer_id_uq
    ON public.harnesses (computer_id)
    WHERE computer_id IS NOT NULL AND deleted_at IS NULL;
