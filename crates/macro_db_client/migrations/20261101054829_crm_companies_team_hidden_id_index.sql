-- no-transaction
-- The CRM companies list's viewed_at sort lists never-viewed companies by id
-- descending. Its (team_id, hidden = false) prefix also serves the lookups of
-- crm_companies_visible_team_id_idx, dropped after it. Must stay a single
-- statement, without IF NOT EXISTS (see the last_interaction index), so the
-- drop never runs while this index is INVALID.
CREATE INDEX CONCURRENTLY crm_companies_team_hidden_id_idx
    ON crm_companies (team_id, hidden, id DESC);
