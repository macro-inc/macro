SET LOCAL lock_timeout = '2s';

-- Drive every lookup from the requested tasks and the dependency primary key.
-- Deleted blockers no longer block. Missing Status values count as unfinished.
CREATE FUNCTION task_open_blockers(task_ids UUID[])
RETURNS TABLE(task_id UUID, blocker_id UUID)
LANGUAGE SQL STABLE AS $$
    SELECT edge.dependent_task_id, edge.blocker_task_id
    FROM unnest(task_ids) requested(task_id)
    JOIN task_dependency_edges edge ON edge.dependent_task_id = requested.task_id
    JOIN "Document" blocker ON blocker.id = edge.blocker_task_id::text
        AND blocker."deletedAt" IS NULL
    LEFT JOIN entity_properties status ON status.entity_id = blocker.id
        AND status.entity_type = 'TASK'
        AND status.property_definition_id = '00000001-0000-0000-0000-000000000002'
    WHERE NOT COALESCE(status.values->'value' @>
        '["00000001-0000-0000-0002-000000000004"]'::jsonb, FALSE)
$$;

-- The storage guard covers legacy status writers as well as the properties
-- service. The same graph lock serializes dependency edits and admission.
CREATE FUNCTION guard_blocked_task_completion() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    policy_enabled BOOLEAN;
BEGIN
    IF NOT COALESCE(NEW.values->'value' @>
        '["00000001-0000-0000-0002-000000000004"]'::jsonb, FALSE) THEN
        RETURN NEW;
    END IF;
    -- Historical non-UUID document IDs cannot participate in this dependency graph.
    IF NEW.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.values IS NOT DISTINCT FROM OLD.values THEN
        RETURN NEW;
    END IF;

    SELECT team.prevent_completing_blocked_tasks INTO policy_enabled
    FROM team WHERE team.id = COALESCE(
        (SELECT owner_id::uuid FROM entity
            WHERE id = NEW.entity_id::uuid AND owner_type = 'team'),
        (SELECT team_id FROM team_task WHERE document_id = NEW.entity_id));
    IF NOT COALESCE(policy_enabled, FALSE) THEN
        RETURN NEW;
    END IF;

    IF NOT pg_try_advisory_xact_lock(747847177) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Task dependencies changed; retry';
    END IF;
    IF EXISTS (SELECT 1 FROM task_open_blockers(ARRAY[NEW.entity_id::uuid])) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            CONSTRAINT = 'task_completion_blocked', MESSAGE = 'Task is blocked';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER task_completion_guard
BEFORE INSERT OR UPDATE OF values ON entity_properties
FOR EACH ROW WHEN (NEW.entity_type = 'TASK' AND
    NEW.property_definition_id = '00000001-0000-0000-0000-000000000002')
EXECUTE FUNCTION guard_blocked_task_completion();
