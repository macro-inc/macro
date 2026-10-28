-- Macro Databases: databases of tables, with typed columns and ordered rows.
--
-- * A column is a property definition. `database_columns` places one in a
--   table; the definition carries the column's name, type, multi-select flag
--   and options. It is owned by the database (`property_definitions.database_id`)
--   or bound from a shared user or team definition.
-- * A row is the property entity (`DATABASE_ROW`, entity id = row id) whose
--   entity properties are its cells. `database_rows` holds a row's identity
--   and order, never its values. A relation is an entity-reference cell
--   naming `DATABASE_ROW` entities.
-- * Positions are fractional keys minted by `models_databases::position`
--   (the `fractional_index` crate). They order as bytes, so every position
--   column is `COLLATE "C"`.
-- * Views are typed JSON, `models_databases::views::ViewQuery` and
--   `ViewLayout`. The schema checks only that each is an object; the service
--   owns their shape.
-- * Triggers keep cells inside the schema: a cell belongs to an existing row
--   and to a column of that row's table, and deleting a row or a column
--   deletes its cells.

CREATE TABLE databases (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at TIMESTAMPTZ
);

CREATE INDEX idx_databases_owner ON databases(owner_id);

CREATE TABLE database_tables (
    id UUID PRIMARY KEY,
    database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    -- The table's SQL name, so unique within its database.
    name TEXT NOT NULL,
    position TEXT COLLATE "C" NOT NULL,
    -- Bumped once by every committed change to the table's schema or rows.
    -- Writers lock this row to serialize; schema edits name the version they
    -- were made against, and change events carry the new one.
    version BIGINT NOT NULL DEFAULT 0,
    -- An import retried after a lost response resolves to the table it made.
    -- The fingerprint tells that replay from a different import reusing the key.
    import_key UUID,
    import_fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Leads with database_id, so it is also the "tables of a database" index.
    UNIQUE (database_id, name)
);

CREATE UNIQUE INDEX database_tables_import_key
    ON database_tables (database_id, import_key) WHERE import_key IS NOT NULL;

CREATE TABLE database_columns (
    id UUID PRIMARY KEY,
    table_id UUID NOT NULL REFERENCES database_tables(id) ON DELETE CASCADE,
    property_definition_id UUID NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
    position TEXT COLLATE "C" NOT NULL,
    -- `ColumnConfig` JSON: a relation's target table, or a lookup's path.
    config JSONB,
    -- A label for this placement only; the definition's name stays the SQL name.
    display_name TEXT,
    -- A new text column whose first value may still settle its type.
    infer_type BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Leads with table_id, so it is also the "columns of a table" index.
    UNIQUE (table_id, property_definition_id)
);

-- Which tables place a definition: definition deletes, shared renames.
CREATE INDEX idx_database_columns_property_definition
    ON database_columns(property_definition_id);

CREATE TABLE database_rows (
    id UUID PRIMARY KEY,
    table_id UUID NOT NULL REFERENCES database_tables(id) ON DELETE CASCADE,
    position TEXT COLLATE "C" NOT NULL,
    -- Provenance only. `User` rows are hard-deleted, and a row others still
    -- use outlives its author.
    created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_database_rows_table ON database_rows(table_id);

-- A view shows one table, shared by everyone who can open the database.
CREATE TABLE database_views (
    id UUID PRIMARY KEY,
    database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES database_tables(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position TEXT COLLATE "C" NOT NULL,
    query JSONB NOT NULL CHECK (jsonb_typeof(query) = 'object'),
    layout JSONB NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX database_views_table_name_key ON database_views (table_id, lower(name));
CREATE INDEX idx_database_views_table_position ON database_views (table_id, position);

-- A board card's lane and its place in that lane. A row without one sorts
-- after the placed cards of its lane.
CREATE TABLE database_view_positions (
    view_id UUID NOT NULL REFERENCES database_views(id) ON DELETE CASCADE,
    -- The option the card's lane holds, or '' for the lane of cards without one.
    lane TEXT NOT NULL,
    row_id UUID NOT NULL REFERENCES database_rows(id) ON DELETE CASCADE,
    position TEXT COLLATE "C" NOT NULL,
    PRIMARY KEY (view_id, row_id)
);

CREATE INDEX idx_database_view_positions_lane
    ON database_view_positions (view_id, lane, position);
-- Serves the cascade from a deleted row.
CREATE INDEX idx_database_view_positions_row ON database_view_positions (row_id);

-- Saved questions. A document's live query node names one of these rather
-- than inlining its SQL. Rows are immutable: editing a question saves a new
-- row and repoints the node, so a document's question never changes under it.
CREATE TABLE database_queries (
    id UUID PRIMARY KEY,
    -- The database whose tables win name resolution. A question outlives its
    -- database, and then reports its tables as missing.
    database_id UUID REFERENCES databases(id) ON DELETE SET NULL,
    -- Versioned so the shape can evolve: {"version": 1, "query": "<sql>"}.
    -- A missing key's type is NULL, which a bare comparison would let pass.
    definition JSONB NOT NULL CHECK (
        jsonb_typeof(definition) = 'object'
        AND jsonb_typeof(definition -> 'version') IS NOT DISTINCT FROM 'number'
        AND jsonb_typeof(definition -> 'query') IS NOT DISTINCT FROM 'string'
    ),
    -- Provenance only; a question embedded in documents outlives its author.
    created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves the ON DELETE SET NULL from a purged database.
CREATE INDEX idx_database_queries_database
    ON database_queries(database_id)
    WHERE database_id IS NOT NULL;

-- The user's first database, made once. The marker survives that database's
-- deletion, so opening the app never recreates what the user removed.
CREATE TABLE database_starter_seeds (
    user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    database_id UUID REFERENCES databases(id) ON DELETE SET NULL
);

-- A definition has exactly one owner: the system, a user, a team, or a database.
ALTER TABLE property_definitions
    ADD COLUMN database_id UUID REFERENCES databases(id) ON DELETE CASCADE;

ALTER TABLE property_definitions DROP CONSTRAINT owned_by_team_or_user_or_system;
ALTER TABLE property_definitions ADD CONSTRAINT owned_by_database_or_team_or_user_or_system CHECK (
    is_system::int
    + (team_id IS NOT NULL)::int
    + (user_id IS NOT NULL)::int
    + (database_id IS NOT NULL)::int = 1
);

-- Column names are unique per table, which the service checks against the
-- table's placements; nothing is unique across a database's definitions.
CREATE INDEX idx_property_definitions_database_id ON property_definitions(database_id)
    WHERE database_id IS NOT NULL;

-- A database-owned definition is not orphaned.
CREATE OR REPLACE FUNCTION delete_orphaned_property_definition()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        IF NEW.team_id IS NULL
           AND NEW.user_id IS NULL
           AND NEW.database_id IS NULL
           AND NEW.is_system = FALSE THEN
            DELETE FROM property_definitions WHERE id = NEW.id;
            RETURN NULL;
        END IF;
        RETURN NEW;
    END;
$$;

-- System property names ("Status", "Priority", ...) are reserved in the
-- shared user and team namespace. A database column lives in its database's
-- own namespace and may use them.
CREATE OR REPLACE FUNCTION check_property_name_not_system()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_system = FALSE AND NEW.database_id IS NULL AND EXISTS (
        SELECT 1 FROM property_definitions
        WHERE is_system = TRUE AND LOWER(display_name) = LOWER(NEW.display_name)
    ) THEN
        RAISE EXCEPTION 'Cannot create custom property with reserved system property name: %', NEW.display_name;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A row's cell names an existing row, by its id's canonical text, and a
-- definition its table places. Key-share locks on the row and the placement
-- make a concurrent delete wait for this write, so its cleanup sees the cell.
CREATE FUNCTION check_database_row_cell()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    row_table UUID;
BEGIN
    IF NEW.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT table_id INTO row_table
        FROM database_rows WHERE id = NEW.entity_id::uuid
        FOR KEY SHARE;
    END IF;
    IF row_table IS NULL THEN
        RAISE EXCEPTION 'database row % does not exist', NEW.entity_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    PERFORM 1 FROM database_columns
    WHERE table_id = row_table AND property_definition_id = NEW.property_definition_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'property definition % is not a column of the table of database row %',
            NEW.property_definition_id, NEW.entity_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER database_row_cell_membership
    BEFORE INSERT OR UPDATE OF entity_id, entity_type, property_definition_id
    ON entity_properties
    FOR EACH ROW
    WHEN (NEW.entity_type = 'DATABASE_ROW')
    EXECUTE FUNCTION check_database_row_cell();

-- A deleted row takes its cells, including through a table or database delete.
CREATE FUNCTION delete_database_row_cells()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM entity_properties
    WHERE entity_id = OLD.id::text AND entity_type = 'DATABASE_ROW';
    RETURN NULL;
END;
$$;

CREATE TRIGGER database_row_cells_cleanup
    AFTER DELETE ON database_rows
    FOR EACH ROW
    EXECUTE FUNCTION delete_database_row_cells();

-- A placement that goes, or comes to name another definition, takes the old
-- definition's cells on its table's rows. The definition and its cells on
-- other tables stay.
CREATE FUNCTION delete_database_column_cells()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM entity_properties
    WHERE entity_type = 'DATABASE_ROW'
      AND property_definition_id = OLD.property_definition_id
      AND entity_id IN (SELECT id::text FROM database_rows WHERE table_id = OLD.table_id);
    RETURN NULL;
END;
$$;

CREATE TRIGGER database_column_cells_cleanup
    AFTER DELETE ON database_columns
    FOR EACH ROW
    EXECUTE FUNCTION delete_database_column_cells();

CREATE TRIGGER database_column_rebind_cells_cleanup
    AFTER UPDATE OF property_definition_id ON database_columns
    FOR EACH ROW
    WHEN (OLD.property_definition_id IS DISTINCT FROM NEW.property_definition_id)
    EXECUTE FUNCTION delete_database_column_cells();
