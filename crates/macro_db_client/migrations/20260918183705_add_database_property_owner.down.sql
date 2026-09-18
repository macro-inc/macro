-- Reverse the database owner scope. Database-owned definitions have no other
-- owner to fall back to, so they are discarded (their options and any entity
-- values cascade).

DELETE FROM property_definitions WHERE database_id IS NOT NULL;

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

DROP INDEX idx_property_definitions_database_id;
DROP INDEX unique_property_definitions_database_display_name;

ALTER TABLE property_definitions DROP CONSTRAINT owned_by_database_or_team_or_user_or_system;
ALTER TABLE property_definitions ADD CONSTRAINT owned_by_team_or_user_or_system CHECK (
    is_system::int + (team_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1
);

ALTER TABLE property_definitions DROP COLUMN database_id;
