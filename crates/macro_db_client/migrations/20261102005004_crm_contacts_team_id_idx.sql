-- no-transaction
-- Team-scoped contact reads go through crm_contacts.team_id now that a
-- contact need not have a company. Single statement: CONCURRENTLY forbids
-- the implicit transaction of a batch. No IF NOT EXISTS, so an INVALID index
-- left by an interrupted build fails the next run instead of passing.
CREATE INDEX CONCURRENTLY crm_contacts_team_id_idx ON crm_contacts (team_id);
