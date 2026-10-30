-- no-transaction

-- The CRM companies list's viewed_at sort lists never-viewed companies by id
-- descending. The index also serves lookups by team and by team plus hidden,
-- so it replaces crm_companies_team_id_idx and
-- crm_companies_visible_team_id_idx, dropped after it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_companies_team_hidden_id_idx
    ON crm_companies (team_id, hidden, id DESC);
