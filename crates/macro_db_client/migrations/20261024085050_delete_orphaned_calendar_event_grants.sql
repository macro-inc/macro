-- no-transaction

-- Delete the access grants of calendar events that were deleted before
-- calendar_event_entity_access_cleanup. Nothing reads them: every reader joins
-- the event row first. One read finds them (no index leads with entity_type),
-- then each batch commits on its own, so no lock outlives a batch. Each delete
-- rechecks that the event is gone, so a rerun after a failure is safe.
-- Keep this file a single statement: COMMIT inside DO needs a top-level call.
DO $$
DECLARE
    batch_size CONSTANT integer := 1000;
    orphaned bigint[];
    batch_start integer := 1;
    batch_deleted integer;
    deleted bigint := 0;
BEGIN
    SELECT COALESCE(array_agg(grant_row.id ORDER BY grant_row.id), '{}')
    INTO orphaned
    FROM entity_access grant_row
    WHERE grant_row.entity_type = 'calendar_event'
      AND NOT EXISTS (
            SELECT 1 FROM calendar_events event WHERE event.id = grant_row.entity_id
      );
    COMMIT;

    WHILE batch_start <= cardinality(orphaned) LOOP
        DELETE FROM entity_access grant_row
        WHERE grant_row.id = ANY(orphaned[batch_start:batch_start + batch_size - 1])
          AND grant_row.entity_type = 'calendar_event'
          AND NOT EXISTS (
                SELECT 1 FROM calendar_events event WHERE event.id = grant_row.entity_id
          );
        GET DIAGNOSTICS batch_deleted = ROW_COUNT;
        deleted := deleted + batch_deleted;
        COMMIT;
        batch_start := batch_start + batch_size;
    END LOOP;

    RAISE NOTICE 'deleted % access grants of deleted calendar events', deleted;
END $$;
