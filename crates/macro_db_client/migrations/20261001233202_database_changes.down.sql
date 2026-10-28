-- Forgets every database's change history.
ALTER TABLE database_rows DROP COLUMN IF EXISTS updated_by;
DROP TABLE IF EXISTS database_change_columns;
DROP TABLE IF EXISTS database_change_rows;
DROP TABLE IF EXISTS database_changes;
