-- no-transaction
-- A bought computer provisions while its charge settles (billing
-- `charging`); a team has at most one such unpaid computer at a time. Purchases
-- check it under the host locks; this index backs that check and answers it.
-- Built CONCURRENTLY so computer writes continue. IF NOT EXISTS does not
-- repair an INVALID index left by an interrupted build: check `SELECT
-- indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('hosted_runtime_charging_team_idx')`, and if false run `DROP
-- INDEX CONCURRENTLY hosted_runtime_charging_team_idx` before retrying.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS hosted_runtime_charging_team_idx
    ON public.hosted_runtime (team_id)
    WHERE (state->'billing'->>'billing') = 'charging';
