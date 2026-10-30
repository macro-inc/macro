-- no-transaction
-- The composite cursor indexes also cover table_id lookups and cascade deletes.
-- Keep this separate: CONCURRENTLY requires a single statement per SQLx migration.
DROP INDEX CONCURRENTLY IF EXISTS idx_database_rows_table;
