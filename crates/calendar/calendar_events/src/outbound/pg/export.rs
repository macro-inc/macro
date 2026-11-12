//! Series content of one event the requester can see, for iCalendar export
//! and for copying onto their own calendar, and what forwarding their own
//! copy needs besides.

use super::*;
use crate::domain::ics::{CalendarEventExport, CalendarEventExportAccess, ForwardedCopy, JoinLink};

struct ExportRow {
    is_channel_shared: bool,
    owner_id: String,
    event_type: String,
    ical_uid: String,
    sequence: i32,
    title: String,
    description: Option<String>,
    location: Option<String>,
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    time_zone: Option<String>,
    recurrence_lines: Vec<String>,
    organizer_email: Option<String>,
    organizer_name: Option<String>,
    updated_at: DateTime<Utc>,
}

pub(super) async fn event_export(
    pool: &PgPool,
    requester_id: &str,
    event_id: Uuid,
) -> Result<Option<CalendarEventExport>, Report> {
    // Same resolution as the mention preview: any live projection of the
    // meeting on the requester's own or linked calendars wins, and only
    // without one does a channel share of the requested row count.
    let row = sqlx::query_as!(
        ExportRow,
        r#"
        SELECT
            resolved.is_channel_shared AS "is_channel_shared!",
            resolved.owner_id AS "owner_id!",
            resolved.event_type AS "event_type!",
            -- The meeting's UID, not an Outlook copy's Exchange wrapper of it:
            -- an .ics or a snapshot carries it to other calendars.
            calendar_meeting_uid(resolved.ical_uid) AS "ical_uid!",
            resolved.sequence AS "sequence!",
            resolved.title AS "title!",
            resolved.description,
            resolved.location,
            resolved.starts_at,
            resolved.ends_at,
            resolved.start_date,
            resolved.end_date,
            resolved.time_zone,
            resolved.recurrence_lines AS "recurrence_lines!",
            resolved.organizer_email,
            resolved.organizer_name,
            resolved.updated_at AS "updated_at!"
        FROM calendar_events requested
        CROSS JOIN LATERAL (
            SELECT
                false AS is_channel_shared,
                (candidate.owner_id = $1) AS is_owned,
                (candidate.id = requested.id) AS is_requested,
                candidate.id,
                candidate.owner_id,
                candidate.event_type,
                candidate.ical_uid,
                candidate.sequence,
                candidate.title,
                candidate.description,
                candidate.location,
                candidate.starts_at,
                candidate.ends_at,
                candidate.start_date,
                candidate.end_date,
                candidate.time_zone,
                candidate.recurrence_lines,
                candidate.organizer_email,
                candidate.organizer_name,
                candidate.updated_at
            FROM calendar_events candidate
            WHERE calendar_meeting_uid(candidate.ical_uid)
                = calendar_meeting_uid(requested.ical_uid)
              AND candidate.status <> 'cancelled'
              AND (
                    candidate.owner_id = $1
                    OR EXISTS (
                        SELECT 1
                        FROM macro_user_links link
                        WHERE link.link_id = candidate.source_link_id
                          AND link.primary_macro_id = $1
                    )
              )
            UNION ALL
            SELECT
                true,
                false,
                true,
                requested.id,
                requested.owner_id,
                requested.event_type,
                requested.ical_uid,
                requested.sequence,
                requested.title,
                requested.description,
                requested.location,
                requested.starts_at,
                requested.ends_at,
                requested.start_date,
                requested.end_date,
                requested.time_zone,
                requested.recurrence_lines,
                requested.organizer_email,
                requested.organizer_name,
                requested.updated_at
            WHERE requested.visibility IN ('default', 'public')
              AND EXISTS (
                    SELECT 1
                    FROM entity_access grant_row
                    JOIN comms_channel_participants participant
                      ON participant.channel_id::text = grant_row.source_id
                     AND participant.user_id = $1
                     AND participant.left_at IS NULL
                    WHERE grant_row.entity_id = requested.id
                      AND grant_row.entity_type = 'calendar_event'
                      AND grant_row.source_type = 'channel'
              )
            ORDER BY
                is_channel_shared,
                is_owned DESC,
                is_requested DESC,
                updated_at DESC,
                id
            LIMIT 1
        ) resolved
        WHERE requested.id = $2
          AND requested.status <> 'cancelled'
        "#,
        requester_id,
        event_id,
    )
    .fetch_optional(pool)
    .await
    .map_err(report)?;
    row.map(|row| {
        Ok(CalendarEventExport {
            access: if row.is_channel_shared {
                CalendarEventExportAccess::ChannelShared
            } else {
                CalendarEventExportAccess::OwnCopy
            },
            owner_id: row.owner_id,
            event_type: event_type(&row.event_type),
            time: row_time(
                row.starts_at,
                row.ends_at,
                row.start_date,
                row.end_date,
                row.time_zone,
            )?,
            ical_uid: row.ical_uid,
            sequence: u32::try_from(row.sequence).unwrap_or_default(),
            title: row.title,
            description: row.description,
            location: row.location,
            recurrence_lines: row.recurrence_lines,
            organizer_email: row.organizer_email,
            organizer_name: row.organizer_name,
            updated_at: row.updated_at,
        })
    })
    .transpose()
}

/// What the requester's own `event_id` copy shows about its invitation's
/// origin, read from every calendar's source of it, and its conference link.
pub(super) async fn forwarded_copy(
    pool: &PgPool,
    requester_id: &str,
    event_id: Uuid,
) -> Result<Option<ForwardedCopy>, Report> {
    let row = sqlx::query!(
        r#"
        SELECT
            event.conference_url,
            event.conference_provider,
            -- Google's own flag, kept in the payload it sent. Every source
            -- must be a Google private copy: an Outlook copy, or a source
            -- stored before Macro kept Google's whole payload, is no evidence.
            -- A source without the key counts as false, since bool_and skips
            -- NULLs.
            COALESCE(
                bool_and(
                    COALESCE(
                        source.source_kind = 'google'
                            AND source.raw_payload->>'privateCopy' = 'true',
                        false
                    )
                ),
                false
            ) AS "google_private_copy!",
            event.is_snapshot
                OR COALESCE(
                    bool_or(source.normalized_payload->'event'->>'isSnapshot' = 'true'),
                    false
                ) AS "is_snapshot!"
        FROM calendar_events event
        LEFT JOIN calendar_event_sources source ON source.event_id = event.id
        WHERE event.id = $1
          AND event.owner_id = $2
          AND event.status <> 'cancelled'
        GROUP BY event.id
        "#,
        event_id,
        requester_id,
    )
    .fetch_optional(pool)
    .await
    .map_err(report)?;
    Ok(row.map(|row| ForwardedCopy {
        google_private_copy: row.google_private_copy,
        is_snapshot: row.is_snapshot,
        join_link: row.conference_url.map(|url| JoinLink {
            url,
            provider: row.conference_provider.as_deref().map(conference_provider),
        }),
    }))
}
