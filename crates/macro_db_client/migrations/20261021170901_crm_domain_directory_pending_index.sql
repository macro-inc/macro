-- no-transaction
-- Lets the CRM enrichment worker find pending directory entries. Must stay a
-- single statement: sqlx sends no-transaction migrations with multiple
-- statements as one batch, which wraps them in an implicit transaction that
-- CONCURRENTLY forbids.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_domain_directory_pending_idx
    ON crm_domain_directory (enrichment_attempted_at NULLS FIRST, created_at)
    WHERE enriched_at IS NULL;
