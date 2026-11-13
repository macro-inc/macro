-- no-transaction
-- Lets the CRM enrichment worker claim directory entries without walking
-- exhausted or untracked ones, and skip entries in retry backoff with a range
-- condition. Must stay a single statement: sqlx sends no-transaction
-- migrations with multiple statements as one batch, which wraps them in an
-- implicit transaction that CONCURRENTLY forbids. If a build is interrupted,
-- drop the INVALID index before running this migration again; IF NOT EXISTS
-- would otherwise skip the build and record the migration as applied.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_domain_directory_claimable_idx
    ON crm_domain_directory (COALESCE(enrichment_attempted_at, '-infinity'), created_at)
    WHERE enriched_at IS NULL AND NOT enrichment_exhausted AND NOT enrichment_untracked;
