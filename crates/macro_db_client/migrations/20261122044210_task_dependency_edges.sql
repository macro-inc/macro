-- Directed task dependencies. Property assignments own each endpoint, so deleting a
-- task's properties cascades its edges. Keep the primary key useful for dependent
-- lookups and the reverse index useful for Blocking lists.
SET LOCAL lock_timeout = '5s';

-- PostgreSQL 14 compatibility for backfill and deployed writers only.
-- Current application writers supply UUIDv7 identities themselves.
CREATE FUNCTION task_dependency_assignment_id() RETURNS UUID LANGUAGE SQL VOLATILE AS $$
    SELECT encode(set_byte(set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112),
        8, (get_byte(bytes, 8) & 63) | 128), 'hex')::uuid
    FROM (SELECT overlay(gen_random_bytes(16) placing
        decode(lpad(to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0'), 'hex')
        FROM 1 FOR 6) AS bytes) random;
$$;

INSERT INTO property_definitions
    (id, team_id, user_id, display_name, data_type, is_multi_select, specific_entity_type, is_system)
VALUES
    ('00000001-0000-0000-0000-000000000015', NULL, NULL, 'Blocking', 'ENTITY', true, 'TASK', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE task_dependency_edges (
    dependent_task_id UUID NOT NULL,
    blocker_task_id UUID NOT NULL,
    dependent_property_id UUID NOT NULL REFERENCES entity_properties(id) ON DELETE CASCADE,
    blocking_property_id UUID NOT NULL REFERENCES entity_properties(id) ON DELETE CASCADE,
    PRIMARY KEY (dependent_task_id, blocker_task_id),
    CONSTRAINT task_dependency_not_self CHECK (dependent_task_id <> blocker_task_id)
);

CREATE INDEX task_dependency_edges_blocker ON task_dependency_edges (blocker_task_id, dependent_task_id);
CREATE INDEX task_dependency_edges_dependent_property ON task_dependency_edges (dependent_property_id);
CREATE INDEX task_dependency_edges_blocking_property ON task_dependency_edges (blocking_property_id);

-- Rebuild each affected endpoint once per statement, including FK cascades.
CREATE FUNCTION sync_task_dependency_properties() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('macro.task_dependency_backfill', true) = 'on'
       OR NOT EXISTS (SELECT 1 FROM changed_task_dependency_edges) THEN
        RETURN NULL;
    END IF;
    -- Row-first legacy writers must not wait behind graph-first writers.
    IF NOT pg_try_advisory_xact_lock(747847177) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Task dependencies changed; retry';
    END IF;
    UPDATE entity_properties p SET
        values = (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
            jsonb_build_object('type', 'EntityReference', 'value',
            jsonb_agg(jsonb_build_object('entity_id', e.blocker_task_id::text, 'entity_type', 'TASK')
                ORDER BY e.blocker_task_id)) END
            FROM task_dependency_edges e WHERE e.dependent_task_id = changed.dependent_task_id),
        updated_at = now()
    FROM (SELECT DISTINCT dependent_task_id FROM changed_task_dependency_edges) changed
    CROSS JOIN LATERAL (SELECT id FROM entity_properties target
        WHERE target.entity_id = changed.dependent_task_id::text AND target.entity_type = 'TASK'
          AND target.property_definition_id = '00000001-0000-0000-0000-000000000007' LIMIT 1) target
    WHERE p.id = target.id;
    UPDATE entity_properties p SET
        values = (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
            jsonb_build_object('type', 'EntityReference', 'value',
            jsonb_agg(jsonb_build_object('entity_id', e.dependent_task_id::text, 'entity_type', 'TASK')
                ORDER BY e.dependent_task_id)) END
            FROM task_dependency_edges e WHERE e.blocker_task_id = changed.blocker_task_id),
        updated_at = now()
    FROM (SELECT DISTINCT blocker_task_id FROM changed_task_dependency_edges) changed
    CROSS JOIN LATERAL (SELECT id FROM entity_properties target
        WHERE target.entity_id = changed.blocker_task_id::text AND target.entity_type = 'TASK'
          AND target.property_definition_id = '00000001-0000-0000-0000-000000000015' LIMIT 1) target
    WHERE p.id = target.id;
    RETURN NULL;
END;
$$;
CREATE TRIGGER task_dependency_edges_inserted
AFTER INSERT ON task_dependency_edges REFERENCING NEW TABLE AS changed_task_dependency_edges
FOR EACH STATEMENT EXECUTE FUNCTION sync_task_dependency_properties();
CREATE TRIGGER task_dependency_edges_deleted
AFTER DELETE ON task_dependency_edges REFERENCING OLD TABLE AS changed_task_dependency_edges
FOR EACH STATEMENT EXECUTE FUNCTION sync_task_dependency_properties();


-- A standalone CALL can commit batches; a multi-statement DO migration cannot.
CREATE PROCEDURE backfill_task_dependency_edges() LANGUAGE plpgsql AS $$
DECLARE
    cursor_id uuid := '00000000-0000-0000-0000-000000000000';
    next_id uuid;
BEGIN
CREATE TEMP TABLE task_dependency_batch (id uuid PRIMARY KEY, entity_id text, values jsonb);
CREATE TEMP TABLE task_dependency_references (dependent_task_id uuid, blocker_task_id uuid,
    dependent_property_id uuid, PRIMARY KEY (dependent_task_id, blocker_task_id));


    LOOP
        PERFORM set_config('lock_timeout', '5s', true);
        PERFORM pg_advisory_xact_lock(747847177);
        PERFORM set_config('macro.task_dependency_backfill', 'on', true);
        TRUNCATE task_dependency_batch, task_dependency_references;
        -- Bound ordinary batches by assignments and reference volume. Always
        -- admit the first assignment so historical dense rows make progress.
        WITH candidates AS MATERIALIZED (
            SELECT id, entity_id, values FROM entity_properties
            WHERE entity_type = 'TASK'
              AND property_definition_id = '00000001-0000-0000-0000-000000000007'
              AND id > cursor_id
            ORDER BY id LIMIT 500 FOR UPDATE
        ), budget AS (
            SELECT *, row_number() OVER (ORDER BY id) AS position,
                sum(CASE WHEN jsonb_typeof(values->'value') = 'array'
                    THEN jsonb_array_length(values->'value') ELSE 0 END)
                    OVER (ORDER BY id) AS reference_count
            FROM candidates
        )
        INSERT INTO task_dependency_batch (id, entity_id, values)
        SELECT id, entity_id, values FROM budget WHERE position = 1 OR reference_count <= 5000;
        SELECT id INTO next_id FROM task_dependency_batch ORDER BY id DESC LIMIT 1;
        EXIT WHEN next_id IS NULL;

        INSERT INTO task_dependency_references
        SELECT DISTINCT s.entity_id::uuid, target.entity_id::uuid, s.id
        FROM task_dependency_batch s
        CROSS JOIN LATERAL jsonb_array_elements(CASE
            WHEN jsonb_typeof(s.values->'value') = 'array' THEN s.values->'value'
            ELSE '[]'::jsonb END) reference
        JOIN LATERAL (SELECT entity_id FROM entity_properties target
          WHERE target.entity_id = CASE WHEN reference->>'entity_id' ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (reference->>'entity_id')::uuid::text END
         AND target.entity_type = 'TASK'
          LIMIT 1) target ON TRUE
        WHERE s.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND reference->>'entity_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND reference->>'entity_type' = 'TASK'
          AND s.entity_id::uuid <> target.entity_id::uuid
        ON CONFLICT DO NOTHING;

        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
        SELECT task_dependency_assignment_id(), blocker_task_id::text, 'TASK',
               '00000001-0000-0000-0000-000000000015'
        FROM (SELECT DISTINCT blocker_task_id FROM task_dependency_references) blockers
        ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;

        INSERT INTO task_dependency_edges
            (dependent_task_id, blocker_task_id, dependent_property_id, blocking_property_id)
        SELECT r.dependent_task_id, r.blocker_task_id, r.dependent_property_id, p.id
        FROM task_dependency_references r
        JOIN LATERAL (SELECT id FROM entity_properties p WHERE p.entity_id = r.blocker_task_id::text
            AND p.entity_type = 'TASK'
            AND p.property_definition_id = '00000001-0000-0000-0000-000000000015' LIMIT 1) p ON TRUE
        ON CONFLICT (dependent_task_id, blocker_task_id) DO NOTHING;

        UPDATE entity_properties p SET values = (
            SELECT jsonb_build_object('type', 'EntityReference', 'value',
                jsonb_agg(jsonb_build_object('entity_type', 'TASK', 'entity_id', e.dependent_task_id::text)
                    ORDER BY e.dependent_task_id))
            FROM task_dependency_edges e WHERE e.blocker_task_id = changed.task_id)
        FROM (SELECT DISTINCT blocker_task_id AS task_id FROM task_dependency_references) changed
        CROSS JOIN LATERAL (SELECT id FROM entity_properties target
            WHERE target.entity_id = changed.task_id::text AND target.entity_type = 'TASK'
              AND target.property_definition_id = '00000001-0000-0000-0000-000000000015' LIMIT 1) target
        WHERE p.id = target.id;

        cursor_id := next_id;
        COMMIT;
    END LOOP;
    DROP TABLE task_dependency_references, task_dependency_batch;
    PERFORM set_config('macro.task_dependency_backfill', 'off', true);
END;
$$;

-- Keep deployed JSON property writers compatible while service instances roll.
-- Nested edge-to-property updates already have their canonical graph write.
CREATE FUNCTION sync_legacy_task_dependency_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    source_id UUID;
    inverse_definition UUID;
    desired UUID[];
    dependent_ids UUID[];
    blocker_ids UUID[];
BEGIN
    IF pg_trigger_depth() > 1 OR current_setting('macro.task_dependency_backfill', true) = 'on' THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.values IS NULL THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.values IS NOT DISTINCT FROM OLD.values THEN
        RETURN NULL;
    END IF;
    IF NEW.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NULL;
    END IF;
    IF jsonb_array_length(COALESCE(NEW.values->'value', '[]'::jsonb)) > 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'At most 1000 task relationships can be edited at once';
    END IF;
    source_id := NEW.entity_id::uuid;
    IF NOT pg_try_advisory_xact_lock(747847177) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Task dependencies changed; retry';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.values->'value', '[]'::jsonb)) ref
        WHERE ref->>'entity_type' IS DISTINCT FROM 'TASK'
           OR COALESCE(ref->>'entity_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
        RAISE EXCEPTION 'Task dependencies must reference tasks';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT (ref->>'entity_id')::uuid), '{}'::uuid[]) INTO desired
    FROM jsonb_array_elements(COALESCE(NEW.values->'value', '[]'::jsonb)) ref;
    IF EXISTS (SELECT 1 FROM unnest(desired) target(task_id)
        LEFT JOIN LATERAL (SELECT true AS found FROM entity_properties status
            WHERE status.entity_id = target.task_id::text AND status.entity_type = 'TASK'
            LIMIT 1) status ON TRUE WHERE status.found IS NULL) THEN
        RAISE EXCEPTION 'Task dependency endpoint not found';
    END IF;
    IF source_id = ANY(desired) THEN
        RAISE EXCEPTION 'A task cannot depend on itself';
    END IF;

    IF NEW.property_definition_id = '00000001-0000-0000-0000-000000000007' THEN
        inverse_definition := '00000001-0000-0000-0000-000000000015';
        dependent_ids := array_fill(source_id, ARRAY[cardinality(desired)]);
        blocker_ids := desired;
        DELETE FROM task_dependency_edges WHERE dependent_task_id = source_id
            AND NOT (blocker_task_id = ANY(desired));
    ELSE
        inverse_definition := '00000001-0000-0000-0000-000000000007';
        dependent_ids := desired;
        blocker_ids := array_fill(source_id, ARRAY[cardinality(desired)]);
        DELETE FROM task_dependency_edges WHERE blocker_task_id = source_id
            AND NOT (dependent_task_id = ANY(desired));
    END IF;

    IF EXISTS (SELECT 1
        FROM unnest(dependent_ids, blocker_ids) input(dependent, blocker)
        JOIN task_dependency_edges edge ON edge.dependent_task_id = input.blocker
            AND edge.blocker_task_id = input.dependent) THEN
        RAISE EXCEPTION 'Task dependencies cannot contain a direct cycle';
    END IF;

    -- Existing oversized inverses remain removable; only genuinely new edges
    -- consume capacity. The graph lock serializes the check with insertion.
    IF NEW.property_definition_id = '00000001-0000-0000-0000-000000000007' THEN
        IF EXISTS (SELECT 1 FROM unnest(desired) endpoint(id)
            WHERE NOT EXISTS (SELECT 1 FROM task_dependency_edges
                WHERE dependent_task_id = source_id AND blocker_task_id = endpoint.id)
            AND (SELECT count(*) FROM (SELECT 1 FROM task_dependency_edges
                WHERE blocker_task_id = endpoint.id LIMIT 1000) edges) >= 1000) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'At most 1000 task relationships are allowed per property';
        END IF;
    ELSE
        IF EXISTS (SELECT 1 FROM unnest(desired) endpoint(id)
            WHERE NOT EXISTS (SELECT 1 FROM task_dependency_edges
                WHERE blocker_task_id = source_id AND dependent_task_id = endpoint.id)
            AND (SELECT count(*) FROM (SELECT 1 FROM task_dependency_edges
                WHERE dependent_task_id = endpoint.id LIMIT 1000) edges) >= 1000) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'At most 1000 task relationships are allowed per property';
        END IF;
    END IF;

    -- Older tasks do not all have the new inverse assignment yet.
    INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
    SELECT task_dependency_assignment_id(), id::text, 'TASK', inverse_definition FROM unnest(desired) id
    ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;
    INSERT INTO task_dependency_edges (dependent_task_id, blocker_task_id, dependent_property_id, blocking_property_id)
    SELECT input.dependent, input.blocker,
        CASE WHEN NEW.property_definition_id = '00000001-0000-0000-0000-000000000007' THEN NEW.id ELSE inverse.id END,
        CASE WHEN NEW.property_definition_id = '00000001-0000-0000-0000-000000000007' THEN inverse.id ELSE NEW.id END
    FROM unnest(dependent_ids, blocker_ids) input(dependent, blocker)
    JOIN LATERAL (SELECT id FROM entity_properties inverse WHERE inverse.entity_id = CASE
        WHEN NEW.property_definition_id = '00000001-0000-0000-0000-000000000007' THEN input.blocker::text ELSE input.dependent::text END
        AND inverse.entity_type = 'TASK' AND inverse.property_definition_id = inverse_definition
        LIMIT 1) inverse ON TRUE
    ON CONFLICT (dependent_task_id, blocker_task_id) DO NOTHING;
    RETURN NULL;
END;
$$;

CREATE TRIGGER task_dependency_json_changed
AFTER INSERT OR UPDATE OF values ON entity_properties
FOR EACH ROW WHEN (NEW.entity_type = 'TASK' AND NEW.property_definition_id IN
    ('00000001-0000-0000-0000-000000000007', '00000001-0000-0000-0000-000000000015'))
EXECUTE FUNCTION sync_legacy_task_dependency_write();
