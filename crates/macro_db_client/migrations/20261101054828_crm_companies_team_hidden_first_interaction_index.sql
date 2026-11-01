-- no-transaction
-- The same ordered read for the CRM companies list's created_at sort. Must stay
-- a single statement (see the last_interaction index). IF NOT EXISTS does not
-- repair an INVALID index left by an interrupted build; drop it concurrently
-- before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_companies_team_hidden_first_interaction_idx
    ON crm_companies (team_id, hidden, first_interaction DESC NULLS LAST, id DESC);
