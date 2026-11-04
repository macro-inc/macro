-- Additive: legacy services may omit the new metadata during rollout.
SET lock_timeout = '5s';
ALTER TABLE crm_pipeline_entities ADD COLUMN commercial_fields JSONB NOT NULL
    DEFAULT '{"outcome": null, "money": []}'::jsonb;

-- UUIDv7 for migration/compatibility writes on PostgreSQL 16 as well as 18.
CREATE FUNCTION crm_commercial_uuid() RETURNS UUID LANGUAGE SQL VOLATILE AS $$
    SELECT encode(set_byte(set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112),
        8, (get_byte(bytes, 8) & 63) | 128), 'hex')::uuid
    FROM (SELECT overlay(gen_random_bytes(16) placing
        decode(lpad(to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0'), 'hex')
        FROM 1 FOR 6) AS bytes) random;
$$;

-- Only the backfill and pre-upgrade pipeline creators use this path. Current
-- services provision these fields through DatabaseStorageProvisioner.
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
    currencies TEXT[] := ARRAY['USD','EUR','GBP','CAD','AUD','JPY','CHF','CNY','INR','BRL','MXN','SGD','HKD','NZD','SEK','NOK','DKK','ZAR','AED','KRW','PLN','CZK','ILS','SAR','TRY','THB','IDR','MYR','PHP','TWD','VND'];
BEGIN
    SELECT * INTO p FROM crm_pipeline_entities WHERE id = pipeline_id FOR UPDATE;
    IF NOT FOUND OR p.commercial_fields ->> 'outcome' IS NOT NULL THEN RETURN; END IF;
    -- Preserve a user-created field that occupied the reserved system name.
    UPDATE database_columns c SET display_name = 'Outcome (legacy ' || c.id::text || ')'
    FROM property_definitions d WHERE c.table_id = p.table_id
        AND d.id = c.property_definition_id
        AND lower(coalesce(c.display_name, d.display_name)) = 'outcome';
    SELECT coalesce(max(position), '') || '80' INTO position_key FROM database_columns WHERE table_id = p.table_id;
    outcome_id := crm_commercial_uuid();
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
        definition_id := crm_commercial_uuid();
        position_key := position_key || '80';
        field_name := amount.name || ' currency';
        UPDATE database_columns c SET display_name = field_name || ' (legacy ' || c.id::text || ')'
        FROM property_definitions d WHERE c.table_id = p.table_id AND d.id = c.property_definition_id
            AND lower(coalesce(c.display_name, d.display_name)) = lower(field_name);
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
END $$;

CREATE FUNCTION crm_pipeline_commercial_upgrade() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM crm_upgrade_commercial_fields(NEW.id);
    RETURN NULL;
END $$;
CREATE TRIGGER crm_pipeline_commercial_upgrade AFTER INSERT ON crm_pipeline_entities
FOR EACH ROW WHEN (NEW.commercial_fields ->> 'outcome' IS NULL)
EXECUTE FUNCTION crm_pipeline_commercial_upgrade();

SELECT crm_upgrade_commercial_fields(id) FROM crm_pipeline_entities;

-- Defaults for old row creators during rollout; explicit writes still upsert
-- their requested values. Current services also include defaults in their ops.
CREATE FUNCTION crm_pipeline_row_commercial_defaults() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO entity_properties(id, entity_id, entity_type, property_definition_id, values)
    SELECT crm_commercial_uuid(), NEW.id::text, 'DATABASE_ROW', c.property_definition_id,
        jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array(o.id))
    FROM crm_pipeline_entities p
    CROSS JOIN LATERAL (
        SELECT (p.commercial_fields ->> 'outcome')::uuid AS column_id, 'Open' AS label
        UNION ALL SELECT (pair ->> 'currency')::uuid, 'USD' FROM jsonb_array_elements(p.commercial_fields -> 'money') pair
    ) defaults
    JOIN database_columns c ON c.id = defaults.column_id
    JOIN property_options o ON o.property_definition_id = c.property_definition_id AND o.string_value = defaults.label
    WHERE p.table_id = NEW.table_id
    ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;
    RETURN NULL;
END $$;
CREATE TRIGGER crm_pipeline_row_commercial_defaults AFTER INSERT ON database_rows
FOR EACH ROW EXECUTE FUNCTION crm_pipeline_row_commercial_defaults();

-- Seed Outcome once from unambiguous closed stage labels. No stages are changed.
INSERT INTO entity_properties(id, entity_id, entity_type, property_definition_id, values)
SELECT crm_commercial_uuid(), r.id::text, 'DATABASE_ROW', c.property_definition_id,
    jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array(o.id))
FROM crm_pipeline_entities p
JOIN database_rows r ON r.table_id = p.table_id
JOIN database_columns c ON c.id = (p.commercial_fields ->> 'outcome')::uuid
JOIN property_options o ON o.property_definition_id = c.property_definition_id
    AND o.string_value = coalesce((
        SELECT CASE lower(trim(stage_option.string_value)) WHEN 'closed won' THEN 'Won' WHEN 'closed lost' THEN 'Lost' ELSE 'Open' END
        FROM database_columns stage_column JOIN property_definitions d ON d.id = stage_column.property_definition_id
        JOIN entity_properties ep ON ep.property_definition_id = d.id AND ep.entity_type = 'DATABASE_ROW' AND ep.entity_id = r.id::text
        JOIN property_options stage_option ON stage_option.id::text = ep.values -> 'value' ->> 0
        WHERE stage_column.table_id = p.table_id AND lower(coalesce(stage_column.display_name, d.display_name)) = 'stage'
        ORDER BY stage_column.position LIMIT 1
    ), 'Open')
ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;

INSERT INTO entity_properties(id, entity_id, entity_type, property_definition_id, values)
SELECT crm_commercial_uuid(), r.id::text, 'DATABASE_ROW', c.property_definition_id,
    jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array(o.id))
FROM crm_pipeline_entities p
CROSS JOIN LATERAL jsonb_array_elements(p.commercial_fields -> 'money') pair
JOIN database_columns c ON c.id = (pair ->> 'currency')::uuid
JOIN property_options o ON o.property_definition_id = c.property_definition_id AND o.string_value = 'USD'
JOIN database_rows r ON r.table_id = p.table_id
ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;
