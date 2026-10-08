//! Compatibility projection for explicit detail-sharers' public OOO sources.

use crate::domain::models::{EventVisibility, OccurrenceRange, TeamOutOfOffice};
use rootcause::Report;
use sqlx::PgPool;

pub(in crate::outbound) async fn list_team_out_of_office(
    pool: &PgPool,
    requester: &str,
    range: OccurrenceRange,
    limit: u16,
) -> Result<Vec<TeamOutOfOffice>, Report> {
    let rows = sqlx::query!(r#"
        SELECT owner_id AS "owner_id!", event_id AS "event_id!", ical_uid AS "ical_uid!",
            occurrence_key AS "occurrence_key!", title AS "title!", time AS "time!"
        FROM (
            SELECT DISTINCT ON (event.owner_id,event.ical_uid,occurrence.value->>'occurrenceKey')
                event.owner_id, event.id AS event_id, event.ical_uid,
                occurrence.value->>'occurrenceKey' AS occurrence_key,
                COALESCE(exception.value->>'title',source.normalized_payload->'event'->>'title') AS title,
                occurrence.value->'time' AS time
            FROM calendar_event_sources source
            JOIN calendar_events event ON event.id=source.event_id
            JOIN calendars calendar ON calendar.id=source.calendar_id AND calendar.is_primary
                AND NOT calendar.is_deleted AND calendar.synced_at IS NOT NULL AND calendar.last_sync_error IS NULL
                AND calendar.snapshot_normalization_version >= 1
            JOIN calendar_accounts account ON account.id=source.account_id
                AND account.owner_id=event.owner_id
                AND account.sync_status IN ('ready','syncing') AND account.last_sync_error IS NULL
                AND account.last_synced_at > now() - interval '15 minutes'
            JOIN calendar_team_sharing sharing ON sharing.user_id=event.owner_id AND sharing.sharing='all'
            CROSS JOIN LATERAL jsonb_array_elements(source.normalized_payload->'occurrences') occurrence(value)
            LEFT JOIN LATERAL (
                SELECT candidate.value FROM jsonb_array_elements(source.normalized_payload->'overrides') candidate(value)
                WHERE candidate.value->>'recurrenceId'=occurrence.value->>'recurrenceId'
                LIMIT 1
            ) exception ON true
            WHERE event.owner_id IN (
                SELECT teammate.user_id FROM team_user viewer JOIN team_user teammate ON teammate.team_id=viewer.team_id
                WHERE viewer.user_id=$1 AND teammate.user_id<>$1
            )
              AND source.provider_access_role = calendar.access_role
              AND source.normalized_payload->'event'->>'eventType'='out_of_office'
              AND source.normalized_payload->'event'->>'visibility' IN ('default','public')
              AND COALESCE(exception.value->>'visibility','default') IN ('default','public')
              AND source.normalized_payload->'event'->>'status'<>'cancelled'
              AND COALESCE(exception.value->>'status','confirmed')<>'cancelled'
              AND NOT COALESCE((occurrence.value->>'isCancelled')::boolean,false)
              AND (
                (occurrence.value->'time'->>'kind'='timed'
                    AND (occurrence.value->'time'->>'endsAt')::timestamptz>(occurrence.value->'time'->>'startsAt')::timestamptz
                    AND (occurrence.value->'time'->>'startsAt')::timestamptz<$3
                    AND (occurrence.value->'time'->>'endsAt')::timestamptz>$2)
                OR (occurrence.value->'time'->>'kind'='allDay'
                    AND (occurrence.value->'time'->>'startDate')::date<$5
                    AND (occurrence.value->'time'->>'endDate')::date>$4)
              )
            ORDER BY event.owner_id,event.ical_uid,occurrence.value->>'occurrenceKey',source.source_updated_at DESC,source.id DESC
        ) sources
        ORDER BY COALESCE((time->>'startsAt')::timestamptz,(time->>'startDate')::date::timestamp AT TIME ZONE 'UTC'),event_id,occurrence_key
        LIMIT $6
    "#, requester, range.starts_at, range.ends_at, range.start_date, range.end_date, i64::from(limit))
        .fetch_all(pool).await.map_err(|error| rootcause::report!(error))?;
    rows.into_iter()
        .map(|row| {
            Ok(TeamOutOfOffice {
                owner_id: row.owner_id,
                event_id: row.event_id,
                ical_uid: row.ical_uid,
                occurrence_key: row.occurrence_key,
                title: Some(row.title),
                visibility: EventVisibility::Default,
                time: serde_json::from_value(row.time)
                    .map_err(|error| rootcause::report!(error))?,
            })
        })
        .collect()
}
