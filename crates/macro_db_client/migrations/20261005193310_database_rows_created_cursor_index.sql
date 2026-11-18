-- no-transaction
-- Soup pages a table by (created_at, id::text). The text expression preserves
-- the shared Soup cursor ordering while allowing a bounded backward index scan.
-- Do not skip an existing name: an interrupted concurrent build can leave an
-- invalid index. Inspect and drop that index before retrying the migration.
CREATE INDEX CONCURRENTLY idx_database_rows_table_created_cursor
    ON database_rows (table_id, created_at, (id::text));
