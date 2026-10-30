-- no-transaction

-- Superseded by crm_companies_team_hidden_id_idx, which leads with team_id.
DROP INDEX CONCURRENTLY IF EXISTS crm_companies_team_id_idx;
