DROP INDEX database_tables_import_key;
ALTER TABLE database_tables DROP COLUMN import_fingerprint;
ALTER TABLE database_tables DROP COLUMN import_key;
