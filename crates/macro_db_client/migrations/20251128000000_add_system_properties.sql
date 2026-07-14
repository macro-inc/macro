-- System Properties Migration - Schema Changes

ALTER TYPE property_entity_type ADD VALUE IF NOT EXISTS 'COMPANY';
ALTER TYPE property_entity_type ADD VALUE IF NOT EXISTS 'TASK';

ALTER TABLE property_definitions ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE property_definitions DROP CONSTRAINT owned_by_org_or_user;
ALTER TABLE property_definitions ADD CONSTRAINT owned_by_org_or_user_or_system 
    CHECK (
        is_system = TRUE
        OR organization_id IS NOT NULL
        OR user_id IS NOT NULL
    );

-- Prevent custom properties from having the same display_name as system properties
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

CREATE TRIGGER prevent_system_property_name_conflict
    BEFORE INSERT OR UPDATE ON property_definitions
    FOR EACH ROW
    EXECUTE FUNCTION check_property_name_not_system();
