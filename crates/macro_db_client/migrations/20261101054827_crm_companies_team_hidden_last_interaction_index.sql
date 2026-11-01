-- no-transaction
-- The CRM companies list under the updated_at and viewed_updated sorts reads a
-- team's companies in this order and stops at the page size, instead of
-- reading and sorting every company in the team. Must stay a single
-- statement: sqlx sends no-transaction migrations as one batch, and
-- CONCURRENTLY cannot run inside a transaction. IF NOT EXISTS does not repair
-- an INVALID index left by an interrupted build; drop it concurrently before
-- retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_companies_team_hidden_last_interaction_idx
    ON crm_companies (team_id, hidden, last_interaction DESC NULLS LAST, id DESC);
