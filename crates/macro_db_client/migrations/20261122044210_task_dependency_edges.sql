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
    ('00000001-0000-0000-0000-000000000017', NULL, NULL, 'Blocking', 'ENTITY', true, 'TASK', true)
ON CONFLICT (id) DO NOTHING;

-- One SQL capacity definition shared by both legacy directions.
CREATE FUNCTION task_dependency_reference_limit() RETURNS INTEGER
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$ SELECT 1000 $$;

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

-- All graph participants use this namespace and sort the actual signed keys.
CREATE FUNCTION task_dependency_lock_key(task_id UUID) RETURNS BIGINT
LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT hashtextextended('task_dependency:' || task_id::text, 0)
$$;

-- Row-first triggers never wait for graph-first writers. Partial acquisitions
-- release with the failed transaction, including on a hash collision.
CREATE FUNCTION lock_task_dependency_endpoints(task_ids UUID[], try_only BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    lock_key BIGINT;
BEGIN
    FOR lock_key IN SELECT DISTINCT task_dependency_lock_key(id)
        FROM unnest(task_ids) endpoint(id) WHERE id IS NOT NULL ORDER BY 1
    LOOP
        IF try_only THEN
            IF NOT pg_try_advisory_xact_lock(lock_key) THEN
                RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Task dependencies changed; retry';
            END IF;
        ELSE
            PERFORM pg_advisory_xact_lock(lock_key);
        END IF;
    END LOOP;
END;
$$;

-- Rebuild each affected endpoint once per statement, including FK cascades.
CREATE FUNCTION sync_task_dependency_properties() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('macro.task_dependency_backfill', true) = 'on'
       OR NOT EXISTS (SELECT 1 FROM changed_task_dependency_edges) THEN
        RETURN NULL;
    END IF;
    PERFORM lock_task_dependency_endpoints(ARRAY(
        SELECT dependent_task_id FROM changed_task_dependency_edges
        UNION SELECT blocker_task_id FROM changed_task_dependency_edges), TRUE);
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
          AND target.property_definition_id = '00000001-0000-0000-0000-000000000017' LIMIT 1) target
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
    projection_ids uuid[];
BEGIN
-- A retry after committed batches can reuse the same migration connection.
CREATE TEMP TABLE IF NOT EXISTS task_dependency_batch (id uuid PRIMARY KEY, entity_id text, values jsonb);
CREATE TEMP TABLE IF NOT EXISTS task_dependency_references (dependent_task_id uuid, blocker_task_id uuid,
    dependent_property_id uuid, PRIMARY KEY (dependent_task_id, blocker_task_id));
-- Retain touched targets across source commits and same-session retries. A new
-- session reconstructs them by rescanning sources, including conflict-skipped edges.
CREATE TEMP TABLE IF NOT EXISTS task_dependency_projection (task_id uuid PRIMARY KEY)
    ON COMMIT PRESERVE ROWS;


    LOOP
        PERFORM set_config('lock_timeout', '5s', true);
        PERFORM set_config('macro.task_dependency_backfill', 'on', true);
        TRUNCATE task_dependency_batch, task_dependency_references;
        -- Bound ordinary batches by assignments and reference volume. Always
        -- admit the first assignment so historical dense rows make progress.
        WITH candidates AS MATERIALIZED (
            SELECT id, entity_id, values FROM entity_properties
            WHERE entity_type = 'TASK'
              AND property_definition_id = '00000001-0000-0000-0000-000000000007'
              AND id > cursor_id
            ORDER BY id LIMIT 500
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

        -- Discover first, then lock endpoints before any property rows or writes.
        -- Include every source, even assignments with no valid references.
        PERFORM lock_task_dependency_endpoints(ARRAY(
            SELECT entity_id::uuid FROM task_dependency_batch
            WHERE entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            UNION SELECT dependent_task_id FROM task_dependency_references
            UNION SELECT blocker_task_id FROM task_dependency_references));

        -- Row-first writers can hold a source without its endpoint lock. Do not
        -- wait for those rows while holding endpoints; retry the batch instead.
        BEGIN
            PERFORM p.id FROM entity_properties p JOIN task_dependency_batch b ON b.id = p.id
                ORDER BY p.id FOR UPDATE OF p NOWAIT;
        EXCEPTION WHEN lock_not_available THEN
            RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Task dependencies changed; retry';
        END;
        IF EXISTS (SELECT 1 FROM task_dependency_batch b
            LEFT JOIN entity_properties p ON p.id = b.id
            WHERE p.id IS NULL OR p.entity_id IS DISTINCT FROM b.entity_id
                OR p.values IS DISTINCT FROM b.values) THEN
            RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Task dependencies changed; retry';
        END IF;

        -- A target cleanup can finish between discovery and lock acquisition.
        DELETE FROM task_dependency_references r WHERE NOT EXISTS (
            SELECT 1 FROM entity_properties p
            WHERE p.entity_id = r.blocker_task_id::text AND p.entity_type = 'TASK'
            LIMIT 1 OFFSET 0);

        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id)
        SELECT task_dependency_assignment_id(), blocker_task_id::text, 'TASK',
               '00000001-0000-0000-0000-000000000017'
        FROM (SELECT DISTINCT blocker_task_id FROM task_dependency_references) blockers
        ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;

        INSERT INTO task_dependency_edges
            (dependent_task_id, blocker_task_id, dependent_property_id, blocking_property_id)
        SELECT r.dependent_task_id, r.blocker_task_id, r.dependent_property_id, p.id
        FROM task_dependency_references r
        JOIN LATERAL (SELECT id FROM entity_properties p WHERE p.entity_id = r.blocker_task_id::text
            AND p.entity_type = 'TASK'
            AND p.property_definition_id = '00000001-0000-0000-0000-000000000017' LIMIT 1) p ON TRUE
        ON CONFLICT (dependent_task_id, blocker_task_id) DO NOTHING;

        INSERT INTO task_dependency_projection
        SELECT DISTINCT blocker_task_id FROM task_dependency_references ON CONFLICT DO NOTHING;

        cursor_id := next_id;
        COMMIT;
    END LOOP;
    -- Serialize each shared hub once after source discovery, not after every
    -- source batch. Lock first, then aggregate current edges in a fresh snapshot.
    LOOP
        PERFORM set_config('lock_timeout', '5s', true);
        PERFORM set_config('macro.task_dependency_backfill', 'on', true);
        SELECT array_agg(task_id ORDER BY task_id) INTO projection_ids
        FROM (SELECT task_id FROM task_dependency_projection ORDER BY task_id LIMIT 500) page;
        EXIT WHEN projection_ids IS NULL;
        PERFORM lock_task_dependency_endpoints(projection_ids);
        BEGIN
            PERFORM p.id FROM unnest(projection_ids) requested(task_id)
            CROSS JOIN LATERAL (SELECT id FROM entity_properties target
                WHERE target.entity_id = requested.task_id::text AND target.entity_type = 'TASK'
                  AND target.property_definition_id = '00000001-0000-0000-0000-000000000017'
                LIMIT 1) target
            JOIN entity_properties p ON p.id = target.id
            ORDER BY p.id FOR UPDATE OF p NOWAIT;
        EXCEPTION WHEN lock_not_available THEN
            RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Task dependencies changed; retry';
        END;
        WITH canonical AS MATERIALIZED (
            SELECT target.id, graph.values FROM unnest(projection_ids) requested(task_id)
            CROSS JOIN LATERAL (SELECT id FROM entity_properties target
                WHERE target.entity_id = requested.task_id::text AND target.entity_type = 'TASK'
                  AND target.property_definition_id = '00000001-0000-0000-0000-000000000017'
                LIMIT 1) target
            CROSS JOIN LATERAL (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
                jsonb_build_object('type', 'EntityReference', 'value',
                    jsonb_agg(jsonb_build_object('entity_type', 'TASK', 'entity_id', e.dependent_task_id::text)
                        ORDER BY e.dependent_task_id)) END AS values
                FROM task_dependency_edges e WHERE e.blocker_task_id = requested.task_id) graph
        )
        UPDATE entity_properties p SET values = canonical.values, updated_at = now()
        FROM canonical WHERE p.id = canonical.id AND p.values IS DISTINCT FROM canonical.values;
        DELETE FROM task_dependency_projection WHERE task_id = ANY(projection_ids);
        COMMIT;
    END LOOP;
    DROP TABLE task_dependency_projection, task_dependency_references, task_dependency_batch;
    PERFORM set_config('macro.task_dependency_backfill', 'off', true);
END;
$$;

-- Keep deployed JSON property writers compatible while service instances roll.
-- Nested edge-to-property updates already have their canonical graph write.
-- Follow-up: drop task_dependency_json_changed and its function only after all
-- legacy JSON writers drain. The bridge has no actor context for target authorization.
CREATE FUNCTION sync_legacy_task_dependency_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    source_id UUID;
    inverse_definition UUID;
    desired UUID[];
    dependent_ids UUID[];
    blocker_ids UUID[];
    canonical_value jsonb;
    current_targets UUID[];
BEGIN
    IF pg_trigger_depth() > 1 OR current_setting('macro.task_dependency_backfill', true) = 'on' THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.values IS NULL THEN
        RETURN NULL;
    END IF;
    IF NEW.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NULL;
    END IF;
    IF jsonb_array_length(COALESCE(NEW.values->'value', '[]'::jsonb)) > task_dependency_reference_limit() THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'At most 1000 task relationships can be edited at once';
    END IF;
    source_id := NEW.entity_id::uuid;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.values->'value', '[]'::jsonb)) ref
        WHERE ref->>'entity_type' IS DISTINCT FROM 'TASK'
           OR COALESCE(ref->>'entity_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
        RAISE EXCEPTION 'Task dependencies must reference tasks';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT (ref->>'entity_id')::uuid ORDER BY (ref->>'entity_id')::uuid), '{}'::uuid[]) INTO desired
    FROM jsonb_array_elements(COALESCE(NEW.values->'value', '[]'::jsonb)) ref;
    -- Include all old endpoints without a cap so historical oversized lists clear.
    PERFORM lock_task_dependency_endpoints(ARRAY[source_id] || desired || ARRAY(
        SELECT blocker_task_id FROM task_dependency_edges WHERE dependent_task_id = source_id
          AND NEW.property_definition_id = '00000001-0000-0000-0000-000000000007'
        UNION SELECT dependent_task_id FROM task_dependency_edges WHERE blocker_task_id = source_id
          AND NEW.property_definition_id = '00000001-0000-0000-0000-000000000017'), TRUE);
    IF EXISTS (SELECT 1 FROM unnest(desired) target(task_id)
        LEFT JOIN LATERAL (SELECT true AS found FROM entity_properties status
            WHERE status.entity_id = target.task_id::text AND status.entity_type = 'TASK'
            LIMIT 1) status ON TRUE WHERE status.found IS NULL) THEN
        RAISE EXCEPTION 'Task dependency endpoint not found';
    END IF;
    IF source_id = ANY(desired) THEN
        RAISE EXCEPTION 'A task cannot depend on itself';
    END IF;

    SELECT CASE WHEN cardinality(desired) = 0 THEN NULL ELSE
        jsonb_build_object('type', 'EntityReference', 'value',
            jsonb_agg(jsonb_build_object('entity_type', 'TASK', 'entity_id', id::text) ORDER BY id)) END
    INTO canonical_value FROM unnest(desired) endpoint(id);
    IF NEW.property_definition_id = '00000001-0000-0000-0000-000000000007' THEN
        SELECT COALESCE(array_agg(blocker_task_id ORDER BY blocker_task_id), '{}'::uuid[])
        INTO current_targets FROM task_dependency_edges WHERE dependent_task_id = source_id;
    ELSE
        SELECT COALESCE(array_agg(dependent_task_id ORDER BY dependent_task_id), '{}'::uuid[])
        INTO current_targets FROM task_dependency_edges WHERE blocker_task_id = source_id;
    END IF;
    -- Only graph equality under endpoint locks permits this fast path. Comparing
    -- OLD and NEW JSON before graph discovery loses stale NULL-to-NULL clears.
    IF current_targets = desired THEN
        UPDATE entity_properties SET values = canonical_value
        WHERE id = NEW.id AND values IS DISTINCT FROM canonical_value;
        RETURN NULL;
    END IF;

    IF NEW.property_definition_id = '00000001-0000-0000-0000-000000000007' THEN
        inverse_definition := '00000001-0000-0000-0000-000000000017';
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
            AND edge.blocker_task_id = input.dependent
        WHERE NOT EXISTS (SELECT 1 FROM task_dependency_edges retained
            WHERE retained.dependent_task_id = input.dependent AND retained.blocker_task_id = input.blocker)) THEN
        RAISE EXCEPTION 'Task dependencies cannot contain a direct cycle';
    END IF;

    -- Existing oversized inverses remain removable; only genuinely new edges
    -- consume capacity. Endpoint locks serialize the check with insertion.
    IF NEW.property_definition_id = '00000001-0000-0000-0000-000000000007' THEN
        IF EXISTS (SELECT 1 FROM unnest(desired) endpoint(id)
            WHERE NOT EXISTS (SELECT 1 FROM task_dependency_edges
                WHERE dependent_task_id = source_id AND blocker_task_id = endpoint.id)
            AND (SELECT count(*) FROM (SELECT 1 FROM task_dependency_edges
                WHERE blocker_task_id = endpoint.id LIMIT task_dependency_reference_limit()) edges) >= task_dependency_reference_limit()) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'At most 1000 task relationships are allowed per property';
        END IF;
    ELSE
        IF EXISTS (SELECT 1 FROM unnest(desired) endpoint(id)
            WHERE NOT EXISTS (SELECT 1 FROM task_dependency_edges
                WHERE blocker_task_id = source_id AND dependent_task_id = endpoint.id)
            AND (SELECT count(*) FROM (SELECT 1 FROM task_dependency_edges
                WHERE dependent_task_id = endpoint.id LIMIT task_dependency_reference_limit()) edges) >= task_dependency_reference_limit()) THEN
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
    -- Conflict-only edge inserts fire an empty transition table. Normalize the
    -- authored source explicitly even when graph membership did not change.
    UPDATE entity_properties SET values = canonical_value
    WHERE id = NEW.id AND values IS DISTINCT FROM canonical_value;
    RETURN NULL;
END;
$$;

CREATE TRIGGER task_dependency_json_changed
AFTER INSERT OR UPDATE OF values ON entity_properties
FOR EACH ROW WHEN (NEW.entity_type = 'TASK' AND NEW.property_definition_id IN
    ('00000001-0000-0000-0000-000000000007', '00000001-0000-0000-0000-000000000017'))
EXECUTE FUNCTION sync_legacy_task_dependency_write();
