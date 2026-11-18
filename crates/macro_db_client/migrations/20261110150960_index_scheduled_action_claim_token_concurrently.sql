-- no-transaction
-- Finds the routine whose running run opened an agent session: a run's
-- claim token is its id and the id of the session its Ask AI step opens.
-- Partial: only routines with a run in progress hold a token. Built
-- CONCURRENTLY so routines keep saving and running. IF NOT EXISTS does not
-- repair an INVALID index left by an interrupted build: check `SELECT
-- indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('scheduled_action_claim_token_idx')`, and if false run `DROP
-- INDEX CONCURRENTLY scheduled_action_claim_token_idx` before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduled_action_claim_token_idx
    ON scheduled_action (claim_token)
    WHERE claim_token IS NOT NULL;
