-- Properties Database Schema
-- This database stores properties and metadata for entities
-- Create enums for property types

CREATE TYPE property_data_type AS ENUM (
    -- Primitive types
    'BOOLEAN',
    'DATE',
    'NUMBER',
    'STRING',
    -- Select types (property options)
    'SELECT_NUMBER',
    'SELECT_STRING',
    -- Entity type
    'ENTITY',
    -- Link Type
    'LINK'
);

CREATE TYPE property_entity_type AS ENUM (
    'CHANNEL',
    'CHAT',
    'DOCUMENT',
    'PROJECT',
    'THREAD',
    'USER'
);




-- Property definitions table
CREATE TABLE property_definitions (
    id UUID PRIMARY KEY,
    -- External references
    organization_id INTEGER REFERENCES "Organization"(id) ON DELETE SET NULL,
    user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    -- Property data type
    data_type property_data_type NOT NULL,
    is_multi_select BOOLEAN NOT NULL,
    specific_entity_type property_entity_type,
    -- NULL if data_type is not 'entity' OR if all entity types are allowed
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Ensure at least one owner is set
    CONSTRAINT owned_by_org_or_user CHECK (
        organization_id IS NOT NULL OR user_id IS NOT NULL
    ),
    -- Prevent duplicate display names within organization and user scopes
    CONSTRAINT unique_property_definitions_org_display_name UNIQUE (organization_id, display_name),
    CONSTRAINT unique_property_definitions_user_display_name UNIQUE (user_id, display_name)
);

-- Indexes for property definitions table
CREATE INDEX idx_property_definitions_organization_id ON property_definitions(organization_id)
    WHERE organization_id IS NOT NULL;
CREATE INDEX idx_property_definitions_user_id ON property_definitions(user_id)
    WHERE user_id IS NOT NULL;

-- Cascade deletion handling for property_definitions
-- When a user or organization is deleted, the corresponding foreign key is set to NULL (ON DELETE SET NULL).
-- This trigger handles the cleanup logic:
--   - If organization_id exists: Only the user_id is removed (organization still owns the property)
--   - If organization_id does not exist: The entire property_definition is deleted (no remaining owner)
-- This ensures properties are only deleted when they become truly orphaned (both foreign keys NULL).
CREATE OR REPLACE FUNCTION delete_orphaned_property_definition()
    RETURNS TRIGGER 
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        IF NEW.organization_id IS NULL AND NEW.user_id IS NULL THEN
            DELETE FROM property_definitions WHERE id = NEW.id;
            RETURN NULL;
        END IF;
        RETURN NEW;
    END;
$$;

-- Trigger that fires after update
CREATE TRIGGER check_orphaned_property_definition
    BEFORE UPDATE ON property_definitions
    FOR EACH ROW
    EXECUTE FUNCTION delete_orphaned_property_definition();




-- Property options table
CREATE TABLE property_options (
    id UUID PRIMARY KEY,
    property_definition_id UUID NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
    display_order INTEGER NOT NULL DEFAULT 0,
    -- Value storage for different types
    number_value DOUBLE PRECISION,
    string_value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Ensure only one is set
    CONSTRAINT check_option_value_set CHECK (
        (number_value IS NOT NULL AND string_value IS NULL) OR
        (number_value IS NULL AND string_value IS NOT NULL)
    ),
    -- Prevent duplicate options within property
    CONSTRAINT unique_property_options_string_value UNIQUE (property_definition_id, string_value),
    CONSTRAINT unique_property_options_number_value UNIQUE (property_definition_id, number_value)
);

-- Indexes for property options table
CREATE INDEX idx_property_options_property_definition_id ON property_options(property_definition_id);




-- Entity properties table
CREATE TABLE entity_properties (
    id UUID PRIMARY KEY,
    -- External entity reference (no foreign key constraints since they're in different databases)
    entity_id TEXT NOT NULL,
    entity_type property_entity_type NOT NULL,
    property_definition_id UUID NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
    
    -- JSONB value with self-describing tagged union structure:
    -- Primitives (always single scalar):
    --   {"type": "Boolean", "value": true}
    --   {"type": "Number", "value": 42.5}
    --   {"type": "String", "value": "text"}
    --   {"type": "Date", "value": "2025-01-01T00:00:00Z"}
    -- SelectOption (ALWAYS array):
    --   Single-select: {"type": "SelectOption", "value": ["uuid"]} (0 or 1 element)
    --   Multi-select:  {"type": "SelectOption", "value": ["uuid1", "uuid2", "uuid3"]} (0+ elements)
    -- EntityReference (ALWAYS array):
    --   Single-select: {"type": "EntityReference", "value": [{"entity_type": "user", "entity_id": "123"}]} (0 or 1 element)
    --   Multi-select:  {"type": "EntityReference", "value": [{"entity_type": "user", "entity_id": "123"}, ...]} (0+ elements)
    -- Link (ALWAYS array):
    --   Single-select: {"type": "Link", "value": ["google.com"]} (0 or 1 element)
    --   Multi-select:  {"type": "Link", "value": ["google.com", "reddit.com"]} (0+ elements)
    -- Can be NULL if property is not set for this entity
    values JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Enforce SelectOption and EntityRef are always arrays
    -- Single vs multi-select is determined by property_definition.is_multi_select, not JSON structure
    CONSTRAINT check_values_structure CHECK (
        values IS NULL
        OR
        (
            values->>'type' IN ('Boolean', 'Number', 'String', 'Date')
            AND jsonb_typeof(values->'value') != 'array'
        )
        OR
        (
            values->>'type' IN ('SelectOption', 'EntityReference', 'Link')
            AND jsonb_typeof(values->'value') = 'array'
        )
    ),

    -- Prevent duplicate property assignments per entity
    CONSTRAINT unique_entity_properties_assignment UNIQUE (entity_id, entity_type, property_definition_id)
);

-- Indexes for entity properties table
CREATE INDEX idx_entity_properties_entity_id ON entity_properties(entity_id, entity_type);
CREATE INDEX idx_entity_properties_property_definition_id ON entity_properties(property_definition_id);

-- GIN index for efficient JSONB queries (filtering by property values)
-- Examples:
--   Find entities with boolean=true: WHERE values @> '{"type": "Boolean", "value": true}'
--   Find entities with number>10: WHERE (values->>'value')::numeric > 10 AND values->>'type' = 'Number'
--   Find entities with string: WHERE values @> '{"type": "String", "value": "text"}'
--   Find entities with specific select option: WHERE values->'value' @> '["uuid"]'::jsonb
--   Find entities with select option containing a specific value: WHERE values->'value' @> '"uuid"'::jsonb
--   Find entities with multiple specific options: WHERE values @> '{"type": "SelectOption", "value": ["uuid1", "uuid2"]}'
--   Find entities by type only: WHERE values @> '{"type": "SelectOption"}'
CREATE INDEX idx_entity_properties_values_gin ON entity_properties USING gin(values jsonb_path_ops);