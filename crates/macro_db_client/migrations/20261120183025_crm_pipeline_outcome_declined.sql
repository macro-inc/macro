-- no-transaction
-- Add the Declined outcome (a deal the team turned down: closed, but not lost)
-- to every pipeline's CRM-owned Outcome field, after its last option. No cell
-- changes: an entry keeps the outcome it has.
-- One pipeline per transaction, so this file is a single statement whose loop
-- commits as it goes (each iteration commits the one before). Each pipeline
-- takes the locks a pipeline writer takes, in its order, but never waits for
-- them: a pipeline in use is skipped, as is one whose other writes would wait
-- past 5s, and one an older service creates while this release rolls out. A
-- rerun of this statement adds the option to those and nothing else, since a
-- field that has Declined, in any case, gets nothing.
-- An added option bumps the table's version and journals the Outcome column,
-- with no ops and an incomplete inverse, so open editors reload the options
-- and a migration is not an undoable user action.
DO $$
DECLARE
    p RECORD;
    outcome_id UUID;
    definition_id UUID;
    option_id UUID;
    added INTEGER;
    new_version BIGINT;
    change_id BIGINT;
BEGIN
    FOR p IN SELECT id, database_id, table_id FROM crm_pipeline_entities
        WHERE commercial_fields ->> 'outcome' IS NOT NULL ORDER BY id
    LOOP
        COMMIT;
        PERFORM set_config('lock_timeout', '5s', true);
        BEGIN
            SELECT (commercial_fields ->> 'outcome')::uuid INTO outcome_id FROM crm_pipeline_entities
            WHERE id = p.id FOR NO KEY UPDATE SKIP LOCKED;
            CONTINUE WHEN NOT FOUND;
            PERFORM 1 FROM database_tables WHERE id = p.table_id FOR UPDATE SKIP LOCKED;
            CONTINUE WHEN NOT FOUND;
            SELECT property_definition_id INTO definition_id FROM database_columns
            WHERE id = outcome_id AND table_id = p.table_id;
            CONTINUE WHEN NOT FOUND;
            -- The lock an option append takes, so two cannot read the same last place.
            PERFORM 1 FROM property_definitions WHERE id = definition_id FOR UPDATE SKIP LOCKED;
            CONTINUE WHEN NOT FOUND OR EXISTS (
                SELECT 1 FROM property_options
                WHERE property_definition_id = definition_id AND lower(string_value) = 'declined'
            );

            -- UUIDv7 on every supported PostgreSQL version.
            SELECT encode(set_byte(set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112),
                8, (get_byte(bytes, 8) & 63) | 128), 'hex')::uuid INTO option_id
            FROM (SELECT overlay(gen_random_bytes(16) placing
                decode(lpad(to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0'), 'hex')
                FROM 1 FOR 6) AS bytes) random;
            -- An appended option takes the palette color of its position
            -- (properties::TagColor::for_position), unless its field's options
            -- have no colors, as the commercial-fields backfill left them.
            INSERT INTO property_options (id, property_definition_id, string_value, display_order, color)
            SELECT option_id, definition_id, 'Declined', coalesce(max(display_order) + 1, 0),
                CASE WHEN bool_or(color IS NOT NULL) THEN (ARRAY['#0091FF', '#46A758', '#8E4EC6',
                    '#F76B15', '#E93D82', '#12A594', '#FFB224', '#3E63DD', '#E5484D', '#F5D90A',
                    '#889096', '#E54D2E'])[count(*) % 12 + 1] END
            FROM property_options WHERE property_definition_id = definition_id
            ON CONFLICT DO NOTHING;
            GET DIAGNOSTICS added = ROW_COUNT;
            CONTINUE WHEN added = 0;

            UPDATE database_tables SET version = version + 1 WHERE id = p.table_id
            RETURNING version INTO new_version;
            INSERT INTO database_changes (database_id, table_id, version, ops, inverse)
            VALUES (p.database_id, p.table_id, new_version, '[]'::jsonb,
                '{"formatVersion":1,"incomplete":true,"ops":[],"before":{"cells":{}},"after":{"cells":{}}}'::jsonb)
            RETURNING id INTO change_id;
            INSERT INTO database_change_columns (change_id, column_id, kind)
            VALUES (change_id, outcome_id, 'add_options');
        EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
            -- Undone with its subtransaction; the pipeline is skipped.
            NULL;
        END;
    END LOOP;
END $$;
