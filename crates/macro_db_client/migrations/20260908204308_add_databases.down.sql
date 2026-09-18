-- Revert 20260918183705_add_database_property_owner first: its
-- `property_definitions.database_id` column references `databases`, so this
-- migration cannot drop that table while it is still in place.

DROP TABLE IF EXISTS database_row_links;
DROP TABLE IF EXISTS database_rows;
DROP TABLE IF EXISTS database_columns;
DROP TABLE IF EXISTS database_tables;
DROP TABLE IF EXISTS databases;
