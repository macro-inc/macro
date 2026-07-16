-- no-transaction

-- The unique_property_options_string_value UNIQUE constraint is a btree index
-- over the full string, and Postgres rejects index rows over ~2704 bytes. That
-- caps option values at ~2.7KB, which breaks large values like the team CRM
-- config JSON (stored in a single option). Enforce the same uniqueness on a
-- sha256 of the value instead, which has no length limit. The old constraint
-- stays in place until this index is built (dropped in the next migration).
CREATE UNIQUE INDEX CONCURRENTLY unique_property_options_string_value_sha256
ON property_options (property_definition_id, digest(string_value, 'sha256'))
WHERE string_value IS NOT NULL;
