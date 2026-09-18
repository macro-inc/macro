-- Macro Databases: a database column IS a property definition, so a definition
-- can now be owned by a database as well as by a user, a team, or the system.
--
-- Precedent: 20260622223029_kill_org_properties_add_team.sql, which added the
-- team owner dimension the same way.

ALTER TABLE property_definitions
    ADD COLUMN database_id UUID REFERENCES databases(id) ON DELETE CASCADE;

-- Exactly one owner: system, user, team, or database.
ALTER TABLE property_definitions DROP CONSTRAINT owned_by_team_or_user_or_system;
ALTER TABLE property_definitions ADD CONSTRAINT owned_by_database_or_team_or_user_or_system CHECK (
    is_system::int
    + (team_id IS NOT NULL)::int
    + (user_id IS NOT NULL)::int
    + (database_id IS NOT NULL)::int = 1
);

-- Column names are unique per database. A partial index rather than a UNIQUE
-- constraint so the rows of every other owner scope stay unconstrained.
CREATE UNIQUE INDEX unique_property_definitions_database_display_name
    ON property_definitions (database_id, display_name)
    WHERE database_id IS NOT NULL;

CREATE INDEX idx_property_definitions_database_id ON property_definitions(database_id)
    WHERE database_id IS NOT NULL;

-- A database-owned definition is not orphaned. Without this the cleanup trigger
-- would delete every column definition on the next UPDATE of its row.
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

-- System property display names ("Status", "Priority", "Source", …) are reserved
-- across the shared user/team namespace, but a database column lives in its own
-- per-database namespace and must be free to use them.
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
