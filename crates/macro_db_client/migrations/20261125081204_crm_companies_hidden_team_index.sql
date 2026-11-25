-- no-transaction
-- CRM email privacy names the team blacklist domains that come from archived
-- companies; without this, stale statistics let it read every company the team
-- has instead of only the archived ones.
-- Use PGOPTIONS='-c lock_timeout=2s' when running migrations. IF NOT EXISTS does
-- not repair an INVALID index from an interrupted build; drop it concurrently
-- before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_companies_hidden_team_idx ON crm_companies (team_id, id)
    WHERE hidden;
