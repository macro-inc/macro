-- no-transaction
-- A merge finds the team members' CRM lists naming a merged company while it
-- holds the team's CRM locks; without this it reads every view they own.
-- Use PGOPTIONS='-c lock_timeout=2s' when running migrations. IF NOT EXISTS does
-- not repair an INVALID index from an interrupted build; drop it concurrently
-- before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS saved_view_crm_list_owner_idx ON saved_view (user_id)
    WHERE config->>'kind' = 'crm-list';
