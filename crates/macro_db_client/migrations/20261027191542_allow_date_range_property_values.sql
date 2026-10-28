SET LOCAL lock_timeout = '5s';

-- A DateRange value is an object with a start and an end.
ALTER TABLE entity_properties
    DROP CONSTRAINT check_values_structure,
    ADD CONSTRAINT check_values_structure CHECK (
        values IS NULL
        OR
        (
            values->>'type' IN ('Boolean', 'Number', 'String', 'Date')
            AND jsonb_typeof(values->'value') != 'array'
        )
        OR
        (
            values->>'type' = 'DateRange'
            AND jsonb_typeof(values->'value') = 'object'
            AND jsonb_typeof(values->'value'->'start') = 'string'
            AND jsonb_typeof(values->'value'->'end') = 'string'
        )
        OR
        (
            values->>'type' IN ('SelectOption', 'EntityReference', 'Link')
            AND jsonb_typeof(values->'value') = 'array'
        )
    ) NOT VALID;
