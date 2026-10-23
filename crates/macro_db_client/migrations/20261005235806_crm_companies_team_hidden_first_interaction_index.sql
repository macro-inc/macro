-- no-transaction

-- The same ordered read for the CRM companies list's created_at sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_companies_team_hidden_first_interaction_idx
    ON crm_companies (team_id, hidden, first_interaction DESC NULLS LAST, id DESC);
