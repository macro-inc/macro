-- no-transaction
-- A bought computer provisions while its charge settles (billing
-- `charging`); a team has at most a few such unpaid computers at a time.
-- Purchases count them under the host locks; this index answers that count.
-- Built CONCURRENTLY so computer writes continue. IF NOT EXISTS does not
-- repair an INVALID index left by an interrupted build: check `SELECT
-- indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('hosted_runtime_charging_team_idx')`, and if false run `DROP
-- INDEX CONCURRENTLY hosted_runtime_charging_team_idx` before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS hosted_runtime_charging_team_idx
    ON public.hosted_runtime (team_id)
    WHERE (state->'billing'->>'billing') = 'charging';
