-- Seed the Outcome and currency cells of rows that existed before the fields.
-- Takes no pipeline lock: writers proceed, and a cell one of them sets first
-- is kept by ON CONFLICT. Until this commits readers treat a missing currency
-- as USD and show a missing Outcome as blank.
-- The option tables were just written and have no statistics yet, so the join
-- order is fixed as written: pipelines first, rows through their table index.
SET LOCAL join_collapse_limit = 1;

-- Outcome, once, from unambiguous closed stage labels. No stages are changed.
INSERT INTO entity_properties(id, entity_id, entity_type, property_definition_id, values)
SELECT crm_commercial_uuid(), r.id::text, 'DATABASE_ROW', c.property_definition_id,
    jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array(o.id))
FROM crm_pipeline_entities p
JOIN database_columns c ON c.id = (p.commercial_fields ->> 'outcome')::uuid
JOIN database_rows r ON r.table_id = p.table_id
CROSS JOIN LATERAL (
    SELECT coalesce((
        SELECT CASE lower(trim(stage_option.string_value)) WHEN 'closed won' THEN 'Won' WHEN 'closed lost' THEN 'Lost' ELSE 'Open' END
        FROM database_columns stage_column JOIN property_definitions d ON d.id = stage_column.property_definition_id
        JOIN entity_properties ep ON ep.property_definition_id = d.id AND ep.entity_type = 'DATABASE_ROW' AND ep.entity_id = r.id::text
        -- Reach the option through its definition's index; a cast on the id alone scans every option.
        JOIN property_options stage_option ON stage_option.property_definition_id = d.id
            AND stage_option.id::text = ep.values -> 'value' ->> 0
        WHERE stage_column.table_id = p.table_id AND lower(coalesce(stage_column.display_name, d.display_name)) = 'stage'
        ORDER BY stage_column.position LIMIT 1
    ), 'Open') AS label
) seeded
JOIN property_options o ON o.property_definition_id = c.property_definition_id
    AND o.string_value = seeded.label
ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;

-- Existing amounts are denominated in USD; nothing is converted.
INSERT INTO entity_properties(id, entity_id, entity_type, property_definition_id, values)
SELECT crm_commercial_uuid(), r.id::text, 'DATABASE_ROW', c.property_definition_id,
    jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array(o.id))
FROM crm_pipeline_entities p
CROSS JOIN LATERAL jsonb_array_elements(p.commercial_fields -> 'money') pair
JOIN database_columns c ON c.id = (pair ->> 'currency')::uuid
JOIN property_options o ON o.property_definition_id = c.property_definition_id AND o.string_value = 'USD'
JOIN database_rows r ON r.table_id = p.table_id
ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;

DROP FUNCTION crm_commercial_uuid();
