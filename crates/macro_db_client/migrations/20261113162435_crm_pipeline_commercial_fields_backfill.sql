-- Give every existing pipeline that tracks a company or contact its Outcome
-- field and a currency field per Amount/Revenue column. Additive: no amount,
-- stage, option or row identity changes. A generic pipeline (record_type IS
-- NULL) is a free-form table and gets neither.
-- Runs apart from the column's DDL so no table lock is held while it writes.
-- Each pipeline row and its table row stay locked until this file commits, in
-- the order the service's write guard and row writers take them, so the file
-- only adds columns and options; the next file seeds the rows one pipeline at
-- a time. A pipeline being written fails this file after 5s instead of
-- queueing writers behind it.
-- Each table's version is bumped and journaled, as any schema change is, so an
-- open editor reloads the new columns and an edit made against the old schema
-- answers a version conflict. The journal entry cannot be undone.
SET LOCAL lock_timeout = '5s';

-- UUIDv7 on every supported PostgreSQL version; the row seeding drops it.
CREATE FUNCTION crm_commercial_uuid() RETURNS UUID LANGUAGE SQL VOLATILE AS $$
    SELECT encode(set_byte(set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112),
        8, (get_byte(bytes, 8) & 63) | 128), 'hex')::uuid
    FROM (SELECT overlay(gen_random_bytes(16) placing
        decode(lpad(to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0'), 'hex')
        FROM 1 FOR 6) AS bytes) random;
$$;

-- Only this backfill uses this function; it is dropped below. Services
-- provision the fields of a new pipeline through DatabaseStorageProvisioner.
CREATE FUNCTION crm_upgrade_commercial_fields(pipeline_id UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    p crm_pipeline_entities;
    amount RECORD;
    column_id UUID;
    definition_id UUID;
    outcome_id UUID;
    position_key TEXT;
    field_name TEXT;
    pairs JSONB := '[]'::jsonb;
    created UUID[] := '{}';
    renamed UUID[] := '{}';
    new_version BIGINT;
    change_id BIGINT;
    currencies TEXT[] := ARRAY['USD','EUR','GBP','CAD','AUD','JPY','CHF','CNY','INR','BRL','MXN','SGD','HKD','NZD','SEK','NOK','DKK','ZAR','AED','KRW','PLN','CZK','ILS','SAR','TRY','THB','IDR','MYR','PHP','TWD','VND'];
BEGIN
    SELECT * INTO p FROM crm_pipeline_entities WHERE id = pipeline_id FOR UPDATE;
    IF NOT FOUND OR p.commercial_fields ->> 'outcome' IS NOT NULL THEN RETURN; END IF;
    -- Row writers serialize on the table row; take it after the pipeline, as they do.
    PERFORM 1 FROM database_tables WHERE id = p.table_id FOR UPDATE;
    -- Preserve a user-created field that occupied the reserved system name.
    WITH legacy AS (
        UPDATE database_columns c SET display_name = 'Outcome (legacy ' || c.id::text || ')'
        FROM property_definitions d WHERE c.table_id = p.table_id
            AND d.id = c.property_definition_id
            AND lower(coalesce(c.display_name, d.display_name)) = 'outcome'
        RETURNING c.id
    )
    SELECT renamed || coalesce(array_agg(id), '{}') INTO renamed FROM legacy;
    SELECT coalesce(max(position), '') || '80' INTO position_key FROM database_columns WHERE table_id = p.table_id;
    outcome_id := crm_commercial_uuid();
    created := created || outcome_id;
    definition_id := crm_commercial_uuid();
    INSERT INTO property_definitions(id, database_id, display_name, data_type, is_multi_select)
    VALUES (definition_id, p.database_id, 'Outcome', 'SELECT_STRING', false);
    INSERT INTO database_columns(id, table_id, property_definition_id, position, nullable)
    VALUES (outcome_id, p.table_id, definition_id, position_key, true);
    INSERT INTO database_column_protections(column_id, capability)
    VALUES (outcome_id, 'delete'), (outcome_id, 'change_type') ON CONFLICT DO NOTHING;
    INSERT INTO property_options(id, property_definition_id, string_value, display_order)
    SELECT crm_commercial_uuid(), definition_id, label, ordinality - 1
    FROM unnest(ARRAY['Open','Won','Lost']) WITH ORDINALITY AS labels(label, ordinality);

    FOR amount IN SELECT c.id, coalesce(c.display_name, d.display_name) AS name
        FROM database_columns c JOIN property_definitions d ON d.id = c.property_definition_id
        WHERE c.table_id = p.table_id AND d.data_type = 'NUMBER' AND NOT d.is_multi_select
        AND c.config IS NULL AND lower(coalesce(c.display_name, d.display_name)) IN ('amount','revenue')
        ORDER BY c.position, c.id
    LOOP
        column_id := crm_commercial_uuid();
        created := created || column_id;
        definition_id := crm_commercial_uuid();
        position_key := position_key || '80';
        field_name := amount.name || ' currency';
        WITH legacy AS (
            UPDATE database_columns c SET display_name = field_name || ' (legacy ' || c.id::text || ')'
            FROM property_definitions d WHERE c.table_id = p.table_id AND d.id = c.property_definition_id
                AND lower(coalesce(c.display_name, d.display_name)) = lower(field_name)
            RETURNING c.id
        )
        SELECT renamed || coalesce(array_agg(id), '{}') INTO renamed FROM legacy;
        INSERT INTO property_definitions(id, database_id, display_name, data_type, is_multi_select)
        VALUES (definition_id, p.database_id, field_name, 'SELECT_STRING', false);
        INSERT INTO database_columns(id, table_id, property_definition_id, position, nullable)
        VALUES (column_id, p.table_id, definition_id, position_key, true);
        INSERT INTO database_column_protections(column_id, capability)
        VALUES (column_id, 'delete'), (column_id, 'change_type'), (amount.id, 'delete'), (amount.id, 'change_type') ON CONFLICT DO NOTHING;
        INSERT INTO property_options(id, property_definition_id, string_value, display_order)
        SELECT crm_commercial_uuid(), definition_id, label, ordinality - 1
        FROM unnest(currencies) WITH ORDINALITY AS labels(label, ordinality);
        pairs := pairs || jsonb_build_array(jsonb_build_object('amount', amount.id, 'currency', column_id));
    END LOOP;
    UPDATE crm_pipeline_entities SET commercial_fields = jsonb_build_object('outcome', outcome_id, 'money', pairs)
    WHERE id = pipeline_id;

    -- One journal entry for the new version, indexed by the columns it touched
    -- so a reader of the table's changes sees its shape moved. It carries no
    -- ops and an incomplete inverse: a migration is not an undoable user action.
    UPDATE database_tables SET version = version + 1 WHERE id = p.table_id RETURNING version INTO new_version;
    INSERT INTO database_changes (database_id, table_id, version, ops, inverse)
    VALUES (p.database_id, p.table_id, new_version, '[]'::jsonb,
        '{"formatVersion":1,"incomplete":true,"ops":[],"before":{"cells":{}},"after":{"cells":{}}}'::jsonb)
    RETURNING id INTO change_id;
    INSERT INTO database_change_columns (change_id, column_id, kind)
    SELECT change_id, touched_column, 'create' FROM unnest(created) AS touched_column
    UNION ALL
    SELECT change_id, touched_column, 'rename' FROM unnest(renamed) AS touched_column;
END $$;

SELECT crm_upgrade_commercial_fields(id) FROM crm_pipeline_entities WHERE record_type IS NOT NULL;

DROP FUNCTION crm_upgrade_commercial_fields(UUID);
