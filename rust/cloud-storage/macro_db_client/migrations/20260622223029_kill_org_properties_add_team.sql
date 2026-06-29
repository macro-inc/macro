-- macro-1987: remove organization-owned properties, introduce team-owned properties.
--
-- Organization ownership is removed entirely. Every organization-referencing property
-- definition is discarded along with its options and entity values (intentional: no
-- organization property data is preserved). Property definitions are now owned by a
-- user, a team, or the system.

-- 1. Discard every organization-referencing property definition. property_options and
--    entity_properties rows cascade via their ON DELETE CASCADE foreign keys.
DELETE FROM property_definitions WHERE organization_id IS NOT NULL;

-- 2. Tear down organization ownership. Dropping the column also drops its FK to "Organization".
ALTER TABLE property_definitions DROP CONSTRAINT owned_by_org_or_user_or_system;
ALTER TABLE property_definitions DROP CONSTRAINT unique_property_definitions_org_display_name;
DROP INDEX idx_property_definitions_organization_id;
ALTER TABLE property_definitions DROP COLUMN organization_id;

-- 3. Introduce team ownership.
ALTER TABLE property_definitions
    ADD COLUMN team_id UUID REFERENCES "team"(id) ON DELETE CASCADE;

ALTER TABLE property_definitions ADD CONSTRAINT owned_by_team_or_user_or_system CHECK (
    is_system = TRUE
    OR team_id IS NOT NULL
    OR user_id IS NOT NULL
);

ALTER TABLE property_definitions
    ADD CONSTRAINT unique_property_definitions_team_display_name UNIQUE (team_id, display_name);

CREATE INDEX idx_property_definitions_team_id ON property_definitions(team_id)
    WHERE team_id IS NOT NULL;

-- 4. Repoint the orphan-cleanup trigger from organization_id to team_id. A definition is
--    orphaned only when it has no team owner, no user owner, and is not a system property
--    (e.g. after the owning user is deleted, which sets user_id to NULL).
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
