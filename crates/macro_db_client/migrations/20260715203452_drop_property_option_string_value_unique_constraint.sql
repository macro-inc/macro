-- The sha256 expression index created in the previous migration now enforces
-- uniqueness of (property_definition_id, string_value), so the size-capped
-- btree constraint can go.
ALTER TABLE property_options
    DROP CONSTRAINT IF EXISTS unique_property_options_string_value;
