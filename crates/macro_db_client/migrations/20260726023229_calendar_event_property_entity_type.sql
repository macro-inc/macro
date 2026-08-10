-- Add migration script here
-- Calendar events become property-bearing entities with the Soup/GraphQL layer.
ALTER TYPE property_entity_type
    ADD VALUE IF NOT EXISTS 'CALENDAR_EVENT';
