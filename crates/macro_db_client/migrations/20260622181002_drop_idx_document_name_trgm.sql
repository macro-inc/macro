-- no-transaction
-- Document name search moved to OpenSearch, so the trigram index that backed
-- the Postgres `name ILIKE '%term%'` path is no longer used. The pg_trgm
-- extension stays — other indexes still rely on it.
DROP INDEX CONCURRENTLY IF EXISTS idx_document_name_trgm;
