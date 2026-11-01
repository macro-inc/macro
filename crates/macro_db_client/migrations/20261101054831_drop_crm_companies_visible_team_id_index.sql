-- no-transaction
-- Superseded by crm_companies_team_hidden_id_idx: visible companies are its
-- (team_id, hidden = false) prefix. crm_companies_team_id_idx stays: queries
-- that read every company in a team, such as the thread-access CRM check, read
-- fewer pages through it than through the wider composite index.
DROP INDEX CONCURRENTLY IF EXISTS crm_companies_visible_team_id_idx;
