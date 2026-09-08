-- Macro Databases: user-facing tables of typed rows, queried through SQL.
--
-- Design notes (see databases-plan/storage.md in the repo root):
--   * Postgres is the only source of truth. User SQL runs against a per-query,
--     permission-scoped, in-memory SQLite materialization — never against these tables.
--   * A column IS a property_definitions row; database_columns holds placement only.
--     Name, data_type, is_multi_select, and options all live on the definition.
--   * A cell is a models_properties PropertyValue (the existing tagged-union JSONB),
--     keyed by property_definition_id. Entity cells store references, never display data.
--   * Link columns store edges in database_row_links (real junction), not in cells.

CREATE TABLE databases (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES "User"(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at TIMESTAMPTZ
);

CREATE INDEX idx_databases_owner ON databases(owner_id);

CREATE TABLE database_tables (
    id UUID PRIMARY KEY,
    database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- Fractional index for tab ordering.
    position TEXT NOT NULL,
    -- Bumped on every row/column/link mutation. Cache key for query
    -- materializations and the invalidation signal for live query chips.
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_database_tables_database ON database_tables(database_id);

-- Placement of a property definition as a column of one table. The definition
-- (owned by the database via property_definitions ownership, or bound to a
-- shared user/team definition) carries the column's name, type, and options.
CREATE TABLE database_columns (
    id UUID PRIMARY KEY,
    table_id UUID NOT NULL REFERENCES database_tables(id) ON DELETE CASCADE,
    property_definition_id UUID NOT NULL REFERENCES property_definitions(id),
    -- Fractional index for column ordering.
    position TEXT NOT NULL,
    -- Column-kind specific configuration: link target {database_id, table_id},
    -- lookup {via_column_id, target}, display width, etc.
    config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (table_id, property_definition_id)
);

CREATE INDEX idx_database_columns_table ON database_columns(table_id);

-- One row per user row; cells are a JSONB object keyed by
-- property_definition_id whose values are models_properties PropertyValue
-- tagged unions, e.g. {"<def uuid>": {"type": "String", "value": "hello"}}.
-- Dense per-row storage (unlike EAV entity_properties): a table fetch is one
-- sequential scan, a row write is one UPDATE. Cell-level querying happens in
-- the SQLite materialization, so no per-cell indexes here.
CREATE TABLE database_rows (
    id UUID PRIMARY KEY,
    table_id UUID NOT NULL REFERENCES database_tables(id) ON DELETE CASCADE,
    -- Fractional index for manual row ordering.
    position TEXT NOT NULL,
    cells JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL REFERENCES "User"(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_database_rows_table ON database_rows(table_id);

-- Many-to-many edges for link columns. One stored direction; the reverse
-- ("linked from") column is computed at read time, so it can never drift.
CREATE TABLE database_row_links (
    link_column_id UUID NOT NULL REFERENCES database_columns(id) ON DELETE CASCADE,
    source_row_id UUID NOT NULL REFERENCES database_rows(id) ON DELETE CASCADE,
    target_row_id UUID NOT NULL REFERENCES database_rows(id) ON DELETE CASCADE,
    position TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (link_column_id, source_row_id, target_row_id)
);

CREATE INDEX idx_database_row_links_target ON database_row_links(target_row_id);
