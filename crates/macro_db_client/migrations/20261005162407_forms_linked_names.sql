-- A form that created its own database is named by that database: renaming
-- either renames both. A form attached to an existing table keeps its own
-- name. Provenance is recorded at creation, never inferred; forms predating
-- this column keep their own names.
ALTER TABLE forms ADD COLUMN name_follows_database BOOLEAN NOT NULL DEFAULT FALSE;
