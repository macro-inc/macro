-- no-transaction
-- Seed the Outcome and currency cells of rows that existed before the fields,
-- one pipeline per transaction: this file is a single statement so that the
-- loop can commit as it goes. Each pipeline's table row is locked, as a row
-- writer locks it, only while that pipeline's own rows are seeded; its version
-- is then bumped and the written rows journaled, so open editors reload them.
-- A cell a writer set first is kept by ON CONFLICT. A table busy for 5s fails
-- the file; a rerun resumes, since pipelines already seeded insert nothing.
-- Until a pipeline is reached, readers treat a missing currency as USD and
-- show a missing Outcome as blank.
DO $$
DECLARE
    p RECORD;
    new_version BIGINT;
    change_id BIGINT;
BEGIN
    FOR p IN SELECT id, database_id, table_id FROM crm_pipeline_entities
        WHERE commercial_fields ->> 'outcome' IS NOT NULL ORDER BY id
    LOOP
        PERFORM set_config('lock_timeout', '5s', true);
        -- The option tables were just written and have no statistics yet, so
        -- the joins run in the order written: rows through their table index.
        PERFORM set_config('join_collapse_limit', '1', true);
        PERFORM 1 FROM database_tables WHERE id = p.table_id FOR UPDATE;

        CREATE TEMP TABLE crm_seeded_cells (row_id UUID NOT NULL, column_id UUID NOT NULL) ON COMMIT DROP;

        -- Outcome, once, from unambiguous closed stage labels. No stages are changed.
        WITH seeded AS (
            INSERT INTO entity_properties(id, entity_id, entity_type, property_definition_id, values)
            SELECT crm_commercial_uuid(), r.id::text, 'DATABASE_ROW', c.property_definition_id,
                jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array(o.id))
            FROM crm_pipeline_entities pipeline
            JOIN database_columns c ON c.id = (pipeline.commercial_fields ->> 'outcome')::uuid
            JOIN database_rows r ON r.table_id = pipeline.table_id
            CROSS JOIN LATERAL (
                SELECT coalesce((
                    SELECT CASE lower(trim(stage_option.string_value)) WHEN 'closed won' THEN 'Won' WHEN 'closed lost' THEN 'Lost' ELSE 'Open' END
                    FROM database_columns stage_column JOIN property_definitions d ON d.id = stage_column.property_definition_id
                    JOIN entity_properties ep ON ep.property_definition_id = d.id AND ep.entity_type = 'DATABASE_ROW' AND ep.entity_id = r.id::text
                    -- Reach the option through its definition's index; a cast on the id alone scans every option.
                    JOIN property_options stage_option ON stage_option.property_definition_id = d.id
                        AND stage_option.id::text = ep.values -> 'value' ->> 0
                    WHERE stage_column.table_id = pipeline.table_id AND lower(coalesce(stage_column.display_name, d.display_name)) = 'stage'
                    ORDER BY stage_column.position LIMIT 1
                ), 'Open') AS label
            ) stage
            JOIN property_options o ON o.property_definition_id = c.property_definition_id
                AND o.string_value = stage.label
            WHERE pipeline.id = p.id
            ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING
            RETURNING entity_id, property_definition_id
        )
        INSERT INTO crm_seeded_cells
        SELECT seeded.entity_id::uuid, c.id FROM seeded
        JOIN database_columns c ON c.table_id = p.table_id AND c.property_definition_id = seeded.property_definition_id;

        -- Existing amounts are denominated in USD; nothing is converted.
        WITH seeded AS (
            INSERT INTO entity_properties(id, entity_id, entity_type, property_definition_id, values)
            SELECT crm_commercial_uuid(), r.id::text, 'DATABASE_ROW', c.property_definition_id,
                jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array(o.id))
            FROM crm_pipeline_entities pipeline
            CROSS JOIN LATERAL jsonb_array_elements(pipeline.commercial_fields -> 'money') pair
            JOIN database_columns c ON c.id = (pair ->> 'currency')::uuid
            JOIN property_options o ON o.property_definition_id = c.property_definition_id AND o.string_value = 'USD'
            JOIN database_rows r ON r.table_id = pipeline.table_id
            WHERE pipeline.id = p.id
            ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING
            RETURNING entity_id, property_definition_id
        )
        INSERT INTO crm_seeded_cells
        SELECT seeded.entity_id::uuid, c.id FROM seeded
        JOIN database_columns c ON c.table_id = p.table_id AND c.property_definition_id = seeded.property_definition_id;

        -- A new version only when cells were written, journaled by row. No ops
        -- and an incomplete inverse: a migration is not an undoable user action.
        IF EXISTS (SELECT 1 FROM crm_seeded_cells) THEN
            UPDATE database_tables SET version = version + 1 WHERE id = p.table_id RETURNING version INTO new_version;
            INSERT INTO database_changes (database_id, table_id, version, ops, inverse)
            VALUES (p.database_id, p.table_id, new_version, '[]'::jsonb,
                '{"formatVersion":1,"incomplete":true,"ops":[],"before":{"cells":{}},"after":{"cells":{}}}'::jsonb)
            RETURNING id INTO change_id;
            INSERT INTO database_change_rows (change_id, row_id, kind, columns)
            SELECT change_id, row_id, 'update', array_agg(column_id) FROM crm_seeded_cells GROUP BY row_id;
        END IF;
        COMMIT;
    END LOOP;
    DROP FUNCTION crm_commercial_uuid();
END $$;
