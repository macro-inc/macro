-- Destroys every database, its rows and its cells. It unwinds an unshipped
-- schema; it is not a production rollback. The DATABASE_ROW enum value stays
-- (see 20261001064034_add_database_row_property_entity_type.down.sql).

DROP TRIGGER IF EXISTS database_row_cell_membership ON entity_properties;
DROP TRIGGER IF EXISTS database_row_cells_cleanup ON database_rows;
DROP TRIGGER IF EXISTS database_column_cells_cleanup ON database_columns;
DROP TRIGGER IF EXISTS database_column_rebind_cells_cleanup ON database_columns;
DROP FUNCTION IF EXISTS check_database_row_cell();
DROP FUNCTION IF EXISTS delete_database_row_cells();
DROP FUNCTION IF EXISTS delete_database_column_cells();

-- Every row cell, the database-owned definitions with their options, and
-- every grant on a database, which no foreign key ties to `databases`.
DELETE FROM entity_properties WHERE entity_type = 'DATABASE_ROW';
DELETE FROM property_definitions WHERE database_id IS NOT NULL;
DELETE FROM entity_access WHERE entity_type = 'database';

CREATE OR REPLACE FUNCTION check_property_name_not_system()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_system = FALSE AND EXISTS (
        SELECT 1 FROM property_definitions
        WHERE is_system = TRUE AND LOWER(display_name) = LOWER(NEW.display_name)
    ) THEN
        RAISE EXCEPTION 'Cannot create custom property with reserved system property name: %', NEW.display_name;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_orphaned_property_definition()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        IF NEW.team_id IS NULL AND NEW.user_id IS NULL AND NEW.is_system = FALSE THEN
            DELETE FROM property_definitions WHERE id = NEW.id;
            RETURN NULL;
        END IF;
        RETURN NEW;
    END;
$$;

DROP INDEX IF EXISTS idx_property_definitions_database_id;
ALTER TABLE property_definitions DROP CONSTRAINT owned_by_database_or_team_or_user_or_system;
ALTER TABLE property_definitions ADD CONSTRAINT owned_by_team_or_user_or_system CHECK (
    is_system::int + (team_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1
);
ALTER TABLE property_definitions DROP COLUMN database_id;

DROP TABLE database_starter_seeds;
DROP TABLE database_queries;
DROP TABLE database_view_positions;
DROP TABLE database_views;
DROP TABLE database_rows;
DROP TABLE database_columns;
DROP TABLE database_tables;
DROP TABLE databases;
