-- The change journal of Macro databases: every committed batch of ops, per
-- table version it produced, with the ops as sent and their inverse.
--
-- * One `database_changes` row per table version: a batch writing two
--   tables makes two, so a table's journal has no gaps and a client that
--   saw version N can ask what changed since.
-- * `ops` is the batch's ops on that table, in the grouped `DatabaseOp`
--   vocabulary. `inverse` is the ops that undo them, newest first, built
--   from the before-image read under the table lock, together with that
--   before-image as a flat `before.cells` map (row, column, value) and what
--   the batch wrote as `after.cells`, so one cell's history reads without
--   replay. Its shape is `models_databases`' `ChangeInverse`.
-- * `database_change_rows` and `database_change_columns` index which rows
--   and columns each change touched, for a row's history and for a
--   refresh that reads only the rows that changed.
-- * No foreign keys to tables, columns or rows: history outlives what it
--   describes, so a deleted row's history still reads. Purging a database
--   deletes its journal, explicitly, as it does its other unkeyed rows.
-- * `actor` and `acting_bot` are provenance only, like `created_by`; a
--   user's deletion does not rewrite history.

CREATE TABLE database_changes (
    id BIGSERIAL PRIMARY KEY,
    database_id UUID NOT NULL,
    table_id UUID NOT NULL,
    version BIGINT NOT NULL,
    actor TEXT,
    acting_bot TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ops JSONB NOT NULL,
    inverse JSONB NOT NULL,
    -- Leads with table_id, so it is also the "changes of a table since" index.
    UNIQUE (table_id, version)
);

-- Serves the purge of a database's journal.
CREATE INDEX idx_database_changes_database ON database_changes (database_id);

CREATE TABLE database_change_rows (
    change_id BIGINT NOT NULL REFERENCES database_changes(id) ON DELETE CASCADE,
    row_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('insert', 'update', 'delete')),
    columns UUID[] NOT NULL
);

-- A row's history, newest first.
CREATE INDEX idx_database_change_rows_row ON database_change_rows (row_id, change_id DESC);
-- Serves the cascade from a purged change.
CREATE INDEX idx_database_change_rows_change ON database_change_rows (change_id);

CREATE TABLE database_change_columns (
    change_id BIGINT NOT NULL REFERENCES database_changes(id) ON DELETE CASCADE,
    column_id UUID NOT NULL,
    kind TEXT NOT NULL
);

-- A column's history, newest first.
CREATE INDEX idx_database_change_columns_column
    ON database_change_columns (column_id, change_id DESC);
-- Serves the cascade from a purged change.
CREATE INDEX idx_database_change_columns_change ON database_change_columns (change_id);

-- Who last wrote a row's cells. Provenance only, like `created_by`.
ALTER TABLE database_rows
    ADD COLUMN updated_by TEXT REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
