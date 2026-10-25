-- Links grant view access only. The markdown document keeps its own ownership,
-- editor grants, and lifetime. Calendar sync never writes this table.
CREATE TABLE calendar_event_notes (
    event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    occurrence_key text NOT NULL,
    document_id text NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE,
    team_id uuid REFERENCES team(id) ON DELETE SET NULL,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, occurrence_key, document_id)
);

CREATE INDEX calendar_event_notes_document_idx ON calendar_event_notes (document_id);
CREATE INDEX calendar_event_notes_team_idx ON calendar_event_notes (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX calendar_event_notes_user_idx ON calendar_event_notes (user_id);

-- Shared by calendar-note reads and the document authorization boundary. A
-- grant is checked at read time so leaving a team/channel or hiding an event
-- revokes inherited access. The caller must be authenticated.
-- One-time meetings follow the event through a reschedule. Recurring notes
-- keep the provider's original-start key and never spread to another instance.
CREATE OR REPLACE FUNCTION calendar_note_link_key(requested_id uuid, occurrence text)
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN cardinality(recurrence_lines) = 0 THEN 'single' ELSE occurrence END
    FROM calendar_events WHERE id = requested_id;
$$;

-- Copy identity is corroborated independently of viewer access. A channel grant
-- on an unrelated fabricated copy must not inject notes into a real meeting.
CREATE OR REPLACE FUNCTION calendar_note_copies_match(requested_id uuid, candidate_id uuid, occurrence text)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM calendar_events requested
        JOIN calendar_event_occurrences requested_occurrence
          ON requested_occurrence.event_id = requested.id AND (requested_occurrence.occurrence_key = occurrence OR (occurrence = 'single' AND cardinality(requested.recurrence_lines) = 0))
          AND NOT requested_occurrence.is_cancelled
        LEFT JOIN calendar_event_overrides requested_exception
          ON requested_exception.event_id = requested.id AND requested_exception.recurrence_id = requested_occurrence.recurrence_id
        JOIN calendar_events event ON event.id = candidate_id AND event.ical_uid = requested.ical_uid
          AND lower(event.organizer_email) IS NOT DISTINCT FROM lower(requested.organizer_email)
        JOIN calendar_event_occurrences event_occurrence
          ON event_occurrence.event_id = event.id AND (event_occurrence.occurrence_key = occurrence OR (occurrence = 'single' AND cardinality(event.recurrence_lines) = 0))
          AND NOT event_occurrence.is_cancelled
        LEFT JOIN calendar_event_overrides event_exception
          ON event_exception.event_id = event.id AND event_exception.recurrence_id = event_occurrence.recurrence_id
        WHERE requested.id = requested_id AND requested.status <> 'cancelled' AND NOT requested.is_snapshot
          AND event.status <> 'cancelled' AND NOT event.is_snapshot
          AND (cardinality(event.recurrence_lines) = 0) = (cardinality(requested.recurrence_lines) = 0)
          AND COALESCE(requested_exception.status, 'confirmed') <> 'cancelled'
          AND COALESCE(event_exception.status, 'confirmed') <> 'cancelled'
          -- A UID is provider input, not an authorization credential. A different
          -- inbox's copy must belong to an organizer/guest on the linked copy.
          AND (event.source_link_id = requested.source_link_id OR EXISTS (
              SELECT 1 FROM email_links inbox WHERE inbox.id = event.source_link_id
                AND (lower(inbox.email_address) = lower(requested.organizer_email) OR (
                  COALESCE(requested_exception.attendees_overridden, false) AND EXISTS (
                    SELECT 1 FROM calendar_event_override_attendees guest
                    WHERE guest.event_id = requested.id AND guest.recurrence_id = requested_exception.recurrence_id
                      AND lower(guest.email) = lower(inbox.email_address)
                  )
                ) OR (NOT COALESCE(requested_exception.attendees_overridden, false) AND EXISTS (
                    SELECT 1 FROM calendar_event_attendees guest
                    WHERE guest.event_id = requested.id AND lower(guest.email) = lower(inbox.email_address)
                )))
          ))
          -- Corroborate in both directions: a fabricated copy cannot inject
          -- notes into a real meeting merely by claiming its organizer/UID.
          AND (event.source_link_id = requested.source_link_id OR EXISTS (
              SELECT 1 FROM email_links inbox WHERE inbox.id = requested.source_link_id
                AND (lower(inbox.email_address) = lower(event.organizer_email) OR (
                  COALESCE(event_exception.attendees_overridden, false) AND EXISTS (
                    SELECT 1 FROM calendar_event_override_attendees guest
                    WHERE guest.event_id = event.id AND guest.recurrence_id = event_exception.recurrence_id
                      AND lower(guest.email) = lower(inbox.email_address)
                  )
                ) OR (NOT COALESCE(event_exception.attendees_overridden, false) AND EXISTS (
                    SELECT 1 FROM calendar_event_attendees guest
                    WHERE guest.event_id = event.id AND lower(guest.email) = lower(inbox.email_address)
                )))
          ))
    );
$$;

CREATE OR REPLACE FUNCTION calendar_note_event_visible(viewer_id text, requested_id uuid, occurrence text)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT viewer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM calendar_events requested
        JOIN calendar_events event ON event.ical_uid = requested.ical_uid
          AND lower(event.organizer_email) IS NOT DISTINCT FROM lower(requested.organizer_email)
        WHERE requested.id = requested_id
          AND calendar_note_copies_match(requested.id, event.id, occurrence)
          AND (
              event.owner_id = viewer_id
              OR EXISTS (
                  SELECT 1 FROM macro_user_links link
                  WHERE link.link_id = event.source_link_id AND link.primary_macro_id = viewer_id
              )
              OR (
                  event.visibility IN ('default', 'public')
                  AND NOT EXISTS (
                      SELECT 1 FROM calendar_event_sources source
                      CROSS JOIN LATERAL jsonb_array_elements(source.normalized_payload->'occurrences') item(value)
                      CROSS JOIN LATERAL jsonb_array_elements(source.normalized_payload->'overrides') exception(value)
                      WHERE source.event_id = event.id AND (item.value->>'occurrenceKey' = occurrence OR (occurrence = 'single' AND cardinality(event.recurrence_lines) = 0))
                        AND exception.value->>'recurrenceId' = item.value->>'recurrenceId'
                        AND (exception.value->>'visibility' IN ('private', 'confidential')
                          OR exception.value->>'status' = 'cancelled')
                  )
                  AND EXISTS (
                      SELECT 1 FROM entity_access grant_row
                      JOIN comms_channel_participants participant
                        ON participant.channel_id::text = grant_row.source_id
                       AND participant.user_id = viewer_id AND participant.left_at IS NULL
                      WHERE grant_row.entity_id = event.id
                        AND grant_row.entity_type = 'calendar_event' AND grant_row.source_type = 'channel'
                  )
              )
              OR EXISTS (
                  SELECT 1 FROM calendar_event_sources source
                  JOIN calendars calendar ON calendar.id = source.calendar_id AND NOT calendar.is_deleted
                    AND calendar.synced_at IS NOT NULL AND calendar.last_sync_error IS NULL
                    AND calendar.snapshot_normalization_version >= 1
                    AND source.provider_access_role IS NOT NULL
                    AND source.provider_access_role = calendar.access_role
                  JOIN calendar_accounts account ON account.id = source.account_id
                    AND account.sync_status IN ('ready', 'syncing') AND account.last_sync_error IS NULL
                    AND account.last_synced_at > now() - interval '15 minutes'
                  JOIN calendar_team_sharing policy ON policy.sharing = 'all'
                    AND (policy.user_id = account.owner_id OR EXISTS (
                        SELECT 1 FROM macro_user_links link
                        WHERE link.link_id = account.email_link_id AND link.primary_macro_id = policy.user_id
                    ))
                  JOIN team_user sharer ON sharer.user_id = policy.user_id
                  JOIN team_user viewer ON viewer.team_id = sharer.team_id AND viewer.user_id = viewer_id
                  CROSS JOIN LATERAL jsonb_array_elements(source.normalized_payload->'occurrences') item(value)
                  WHERE source.event_id = event.id
                    AND source.normalized_payload->'event'->>'status' <> 'cancelled'
                    AND source.normalized_payload->'event'->>'visibility' IN ('default', 'public')
                    AND (item.value->>'occurrenceKey' = occurrence OR (occurrence = 'single' AND cardinality(event.recurrence_lines) = 0))
                    AND NOT COALESCE((item.value->>'isCancelled')::boolean, false)
                    AND NOT EXISTS (
                        SELECT 1 FROM jsonb_array_elements(source.normalized_payload->'overrides') exception(value)
                        WHERE exception.value->>'recurrenceId' = item.value->>'recurrenceId'
                          AND (exception.value->>'visibility' IN ('private', 'confidential')
                            OR exception.value->>'status' = 'cancelled')
                    )
              )
          )
    );
$$;
