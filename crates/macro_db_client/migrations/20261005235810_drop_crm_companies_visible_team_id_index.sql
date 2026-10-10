-- no-transaction

-- Superseded by crm_companies_team_hidden_id_idx: visible companies are its
-- (team_id, hidden = false) prefix.
DROP INDEX CONCURRENTLY IF EXISTS crm_companies_visible_team_id_idx;
