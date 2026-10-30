-- no-transaction

-- Microsoft Graph lists a meeting's organizer as an attendee who has not
-- answered, so every Outlook event stored before October 2026 holds its
-- organizer's row as needs_action, and Macro asked the organizer whether they
-- were going to their own meeting. Sync now stores that row as accepted, but
-- Graph's delta resends only events that changed, so rewrite the stored rows
-- the same way: the entity's and its occurrences' attendees, and every Outlook
-- copy's stored projection a restore would replay. Each event's inbox logs an
-- upsert so calendar caches refetch it. One read finds the events, then each
-- event commits on its own, locking what a calendar write to it locks: its
-- rows, then its inbox's change counter last. A rerun rewrites nothing twice
-- and logs only events still to fix.
-- Keep this file a single statement: COMMIT inside DO needs a top-level call.
DO $$
DECLARE
    link_ids uuid[];
    event_ids uuid[];
    fixing uuid;
    last_seq bigint;
BEGIN
    SELECT COALESCE(array_agg(event.source_link_id ORDER BY event.source_link_id, event.id), '{}'),
           COALESCE(array_agg(event.id ORDER BY event.source_link_id, event.id), '{}')
    INTO link_ids, event_ids
    FROM calendar_events event
    WHERE event.canonical_source_kind = 'outlook'
      AND (
            EXISTS (
                SELECT 1 FROM calendar_event_attendees attendee
                WHERE attendee.event_id = event.id
                  AND attendee.is_organizer
                  AND attendee.response_status = 'needs_action'
            )
            OR EXISTS (
                SELECT 1 FROM calendar_event_override_attendees attendee
                WHERE attendee.event_id = event.id
                  AND attendee.is_organizer
                  AND attendee.response_status = 'needs_action'
            )
            OR EXISTS (
                SELECT 1 FROM calendar_event_sources source
                WHERE source.event_id = event.id
                  AND source.source_kind = 'outlook'
                  AND source.normalized_payload -> 'event' -> 'attendees'
                      @> '[{"isOrganizer": true, "responseStatus": "needs_action"}]'
            )
            OR EXISTS (
                SELECT 1 FROM calendar_event_sources source
                WHERE source.event_id = event.id
                  AND source.source_kind = 'outlook'
                  AND jsonb_typeof(source.normalized_payload -> 'overrides') = 'array'
                  AND jsonb_path_exists(
                        source.normalized_payload,
                        '$.overrides[*].attendees[*] ? (@.isOrganizer == true && @.responseStatus == "needs_action")'
                  )
            )
      );
    COMMIT;

    FOR nth IN 1 .. cardinality(event_ids) LOOP
        fixing := event_ids[nth];

        UPDATE calendar_event_attendees attendee
        SET response_status = 'accepted'
        WHERE attendee.event_id = fixing
          AND attendee.is_organizer
          AND attendee.response_status = 'needs_action';
        UPDATE calendar_event_override_attendees attendee
        SET response_status = 'accepted'
        WHERE attendee.event_id = fixing
          AND attendee.is_organizer
          AND attendee.response_status = 'needs_action';
        UPDATE calendar_event_sources source
        SET normalized_payload = jsonb_set(
                source.normalized_payload,
                '{event,attendees}',
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN listed.attendee @> '{"isOrganizer": true, "responseStatus": "needs_action"}'
                                THEN listed.attendee || '{"responseStatus": "accepted"}'
                            ELSE listed.attendee
                        END
                        ORDER BY listed.position
                    )
                    FROM jsonb_array_elements(source.normalized_payload -> 'event' -> 'attendees')
                        WITH ORDINALITY AS listed(attendee, position)
                )
            )
        WHERE source.event_id = fixing
          AND source.source_kind = 'outlook'
          AND source.normalized_payload -> 'event' -> 'attendees'
              @> '[{"isOrganizer": true, "responseStatus": "needs_action"}]';
        UPDATE calendar_event_sources source
        SET normalized_payload = jsonb_set(
                source.normalized_payload,
                '{overrides}',
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN jsonb_typeof(exception.body -> 'attendees') = 'array' THEN jsonb_set(
                                exception.body,
                                '{attendees}',
                                (
                                    SELECT COALESCE(
                                        jsonb_agg(
                                            CASE
                                                WHEN listed.attendee @> '{"isOrganizer": true, "responseStatus": "needs_action"}'
                                                    THEN listed.attendee || '{"responseStatus": "accepted"}'
                                                ELSE listed.attendee
                                            END
                                            ORDER BY listed.position
                                        ),
                                        '[]'::jsonb
                                    )
                                    FROM jsonb_array_elements(exception.body -> 'attendees')
                                        WITH ORDINALITY AS listed(attendee, position)
                                )
                            )
                            ELSE exception.body
                        END
                        ORDER BY exception.position
                    )
                    FROM jsonb_array_elements(source.normalized_payload -> 'overrides')
                        WITH ORDINALITY AS exception(body, position)
                )
            )
        WHERE source.event_id = fixing
          AND source.source_kind = 'outlook'
          AND jsonb_typeof(source.normalized_payload -> 'overrides') = 'array'
          AND jsonb_path_exists(
                source.normalized_payload,
                '$.overrides[*].attendees[*] ? (@.isOrganizer == true && @.responseStatus == "needs_action")'
          );

        INSERT INTO calendar_change_counters (link_id, seq)
        VALUES (link_ids[nth], 1)
        ON CONFLICT (link_id) DO UPDATE
        SET seq = calendar_change_counters.seq + 1,
            updated_at = now()
        RETURNING seq INTO last_seq;
        INSERT INTO calendar_change_log (link_id, seq, kind, event_id)
        VALUES (link_ids[nth], last_seq, 1, fixing);
        COMMIT;
    END LOOP;

    RAISE NOTICE 'marked the organizers of % Outlook events as holding them',
        cardinality(event_ids);
END $$;
