-- no-transaction

-- Since October 2026 an inbox organizes an event whose organizer is a calendar
-- it can write, not only one whose organizer is its own address, so events
-- made on a secondary calendar gained organizer capabilities (viewerCan).
-- Clients holding a calendar cache refresh only the events the change log
-- lists, so log an upsert for each such event on its inbox's link and every
-- cache refetches it on its next sync. One read finds the events, then each
-- batch commits on its own with its counter locks taken in link order, as
-- every calendar write takes them, so no lock outlives a batch. A rerun after
-- a failure logs some events twice, which costs clients one more refetch.
-- Keep this file a single statement: COMMIT inside DO needs a top-level call.
DO $$
DECLARE
    batch_size CONSTANT integer := 1000;
    link_ids uuid[];
    event_ids uuid[];
    batch_start integer := 1;
    batch_end integer;
    link_batch record;
    last_seq bigint;
BEGIN
    SELECT COALESCE(array_agg(event.source_link_id ORDER BY event.source_link_id, event.id), '{}'),
           COALESCE(array_agg(event.id ORDER BY event.source_link_id, event.id), '{}')
    INTO link_ids, event_ids
    FROM calendar_events event
    JOIN email_links link ON link.id = event.source_link_id
    WHERE event.status <> 'cancelled'
      AND event.organizer_email IS NOT NULL
      AND lower(event.organizer_email) <> lower(link.email_address::text)
      AND EXISTS (
            SELECT 1
            FROM calendar_accounts account
            JOIN calendars calendar ON calendar.account_id = account.id
            WHERE account.email_link_id = link.id
              AND account.sync_status <> 'disabled'
              AND NOT calendar.is_deleted
              AND calendar.access_role IN ('owner', 'writer')
              AND lower(calendar.provider_calendar_id) = lower(event.organizer_email)
      );
    COMMIT;

    WHILE batch_start <= cardinality(event_ids) LOOP
        batch_end := least(batch_start + batch_size - 1, cardinality(event_ids));
        FOR link_batch IN
            SELECT batch.link_id, array_agg(batch.event_id ORDER BY batch.position) AS events
            FROM unnest(link_ids[batch_start:batch_end], event_ids[batch_start:batch_end])
                WITH ORDINALITY AS batch(link_id, event_id, position)
            GROUP BY batch.link_id
            ORDER BY batch.link_id
        LOOP
            INSERT INTO calendar_change_counters (link_id, seq)
            VALUES (link_batch.link_id, cardinality(link_batch.events))
            ON CONFLICT (link_id) DO UPDATE
            SET seq = calendar_change_counters.seq + EXCLUDED.seq,
                updated_at = now()
            RETURNING seq INTO last_seq;
            INSERT INTO calendar_change_log (link_id, seq, kind, event_id)
            SELECT link_batch.link_id,
                   last_seq - cardinality(link_batch.events) + logged.position,
                   1,
                   logged.event_id
            FROM unnest(link_batch.events) WITH ORDINALITY AS logged(event_id, position);
        END LOOP;
        COMMIT;
        batch_start := batch_end + 1;
    END LOOP;

    RAISE NOTICE 'logged % calendar events organized by a calendar their inbox writes',
        cardinality(event_ids);
END $$;
