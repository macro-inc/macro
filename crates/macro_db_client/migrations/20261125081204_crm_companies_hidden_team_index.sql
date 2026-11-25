-- no-transaction
-- CRM email privacy names the team blacklist domains that come from archived
-- companies; without this, stale statistics let it read every company the team
-- has instead of only the archived ones. Only archived companies have an entry.
-- Use PGOPTIONS='-c lock_timeout=2s' when running migrations. Must stay a
-- single statement: CONCURRENTLY cannot run inside a transaction. IF NOT EXISTS
-- does not repair an INVALID index from an interrupted build; drop it
-- concurrently before retrying. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS crm_companies_hidden_team_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_companies_hidden_team_idx ON crm_companies (team_id, id)
    WHERE hidden;
