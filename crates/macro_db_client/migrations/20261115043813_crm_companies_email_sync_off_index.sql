-- no-transaction
-- The CRM Team view's read of a record's emails blocks the domains of the
-- team's companies with email sync off (`team_blocked` in the email crate's
-- dynamic/query/team_scope.rs, `crm_email_domain_blocked`). Without this
-- index every page scans all of crm_companies to find those few companies.
-- Only companies with sync off have an entry, so other writes never touch it.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. IF NOT EXISTS does
-- not repair an INVALID index from an interrupted build; drop it concurrently
-- before retrying. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS crm_companies_email_sync_off_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_companies_email_sync_off_idx
    ON crm_companies (id)
    WHERE NOT email_sync;
