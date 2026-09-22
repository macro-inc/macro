-- A retry after a lost import response must resolve to the same table.
-- Nullable metadata preserves ordinary table creation and existing writers.
ALTER TABLE database_tables ADD COLUMN import_key UUID;
ALTER TABLE database_tables ADD COLUMN import_fingerprint TEXT;
CREATE UNIQUE INDEX database_tables_import_key
    ON database_tables (database_id, import_key) WHERE import_key IS NOT NULL;
