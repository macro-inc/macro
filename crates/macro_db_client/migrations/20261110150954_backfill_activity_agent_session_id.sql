-- no-transaction

-- Set the session on correlated rows written before the trigger. Batches walk
-- the correlation mappings (one per code-mode run, far fewer than activity
-- rows) and update their rows through the correlation index, committing each
-- batch so none holds row locks for long. A rerun rewrites only NULL rows.
-- Runs before the session index is built so updates don't maintain it.
-- Keep this file a single statement: COMMIT inside DO needs a top-level call.
DO $$
DECLARE
    batch_size CONSTANT integer := 500;
    last_id uuid := '00000000-0000-0000-0000-000000000000';
    ids uuid[];
BEGIN
    LOOP
        SELECT array_agg(batch.id ORDER BY batch.id)
        INTO ids
        FROM (
            SELECT id
            FROM agent_correlations
            WHERE id > last_id
            ORDER BY id
            LIMIT batch_size
        ) batch;
        EXIT WHEN ids IS NULL;

        UPDATE activity_events e
        SET agent_session_id = c.agent_session_id
        FROM agent_correlations c
        WHERE c.id = ANY(ids)
          AND e.agent_correlation_id = c.id
          AND e.agent_session_id IS NULL;
        COMMIT;

        last_id := ids[array_length(ids, 1)];
    END LOOP;
END;
$$;
