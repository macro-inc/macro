-- no-transaction
-- The CRM companies list's viewed_at sort lists never-viewed companies by id
-- descending. Its (team_id, hidden = false) prefix also serves the lookups of
-- crm_companies_visible_team_id_idx, dropped after it. Must stay a single
-- statement (see the last_interaction index). IF NOT EXISTS does not repair an
-- INVALID index left by an interrupted build; drop it concurrently before
-- retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_companies_team_hidden_id_idx
    ON crm_companies (team_id, hidden, id DESC);
