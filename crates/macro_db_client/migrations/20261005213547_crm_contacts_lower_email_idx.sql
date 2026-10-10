-- no-transaction
-- The CRM depopulate lookup (crates/crm, `lock_depopulate_target`) matches
--   LOWER(ct.email) = $2 AND co.team_id = $1 AND LOWER(d.domain) = $3
-- and none of those has an index the planner can start from:
-- crm_contacts_email_idx is on the raw column and the (team_id, lower(domain))
-- index is keyed on d.team_id. Each lookup walks the team's companies or scans
-- crm_domains; with this index it starts from the one contact row.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_contacts_lower_email_idx
    ON crm_contacts (LOWER(email));
