-- The UNIQUE constraint on (property_definition_id, string_value) is backed by a
-- btree index over the full string, and Postgres rejects index rows over ~2704
-- bytes. That caps option values at ~2.7KB, which breaks large values like the
-- team CRM config JSON (stored in a single option). Enforce the same uniqueness
-- on an md5 of the value instead, which has no length limit.
ALTER TABLE property_options
    DROP CONSTRAINT IF EXISTS unique_property_options_string_value;

CREATE UNIQUE INDEX IF NOT EXISTS unique_property_options_string_value_md5
    ON property_options (property_definition_id, md5(string_value))
    WHERE string_value IS NOT NULL;
