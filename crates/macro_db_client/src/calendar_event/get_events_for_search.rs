//! Metadata and contextual-occurrence resolution for calendar event search
//! hits.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// One calendar event's search metadata, with the instance a result row
/// should point at already resolved.
#[derive(Debug, Clone)]
pub struct CalendarEventSearchInfo {
    /// Event entity id.
    pub id: Uuid,
    /// Owner of this per-user projection.
    pub owner_id: String,
    /// Series title.
    pub title: String,
    /// Canonical status.
    pub status: String,
    /// Master span start, for a timed series.
    pub starts_at: Option<DateTime<Utc>>,
    /// Master span end, for a timed series.
    pub ends_at: Option<DateTime<Utc>>,
    /// Master span start date, for an all-day series.
    pub start_date: Option<NaiveDate>,
    /// Master span end date, for an all-day series.
    pub end_date: Option<NaiveDate>,
    /// Original IANA zone, when the source supplied one.
    pub time_zone: Option<String>,
    /// Whether the series carries any recurrence rule.
    pub is_recurring: bool,
    /// Direct conference join URL.
    pub conference_url: Option<String>,
    /// Organizer email, when the source names one.
    pub organizer_email: Option<String>,
    /// Organizer display name, when the source names one.
    pub organizer_name: Option<String>,
    /// Free-text event description, when the source carries one.
    pub description: Option<String>,
    /// Whether the canonical source prohibits mutation.
    pub is_read_only: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Stable key of the resolved instance, when one is materialized.
    pub occurrence_key: Option<String>,
    /// Resolved instance span.
    pub occurrence_starts_at: Option<DateTime<Utc>>,
    pub occurrence_ends_at: Option<DateTime<Utc>>,
    pub occurrence_start_date: Option<NaiveDate>,
    pub occurrence_end_date: Option<NaiveDate>,
}

/// Fetch search metadata for `event_ids` the requester may see, resolving one
/// contextual occurrence per event.
///
/// Visibility mirrors the soup predicate: the requester owns the projection,
/// or the event's source link is delegated to them through `macro_user_links`.
/// An id the requester cannot see is simply absent from the result, which
/// drops the hit during enrichment.
///
/// A recurring series is indexed once, as its master, so the instance a row
/// should display is decided here rather than baked into the index. The
/// lateral prefers the next occurrence at or after `now`, falling back to the
/// most recent past one — the same ordering `mention_previews` uses, so a
/// search row and a mention of the same event agree on where they land.
/// Occurrences are materialized only inside a rolling window, so a series can
/// legitimately resolve to no occurrence at all; callers fall back to the
/// master span.
#[tracing::instrument(skip(db, event_ids), fields(event_count = event_ids.len()), err)]
pub async fn get_calendar_events_for_search(
    db: &Pool<Postgres>,
    requester_id: &str,
    event_ids: &[Uuid],
    now: DateTime<Utc>,
) -> anyhow::Result<HashMap<Uuid, CalendarEventSearchInfo>> {
    if event_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT
            event.id AS "id!",
            event.owner_id AS "owner_id!",
            event.title AS "title!",
            event.status AS "status!",
            event.starts_at,
            event.ends_at,
            event.start_date,
            event.end_date,
            event.time_zone,
            (cardinality(event.recurrence_lines) > 0) AS "is_recurring!",
            event.conference_url,
            event.organizer_email,
            event.organizer_name,
            event.description,
            event.is_read_only AS "is_read_only!",
            event.created_at AS "created_at!",
            event.updated_at AS "updated_at!",
            occurrence.occurrence_key AS "occurrence_key?",
            occurrence.starts_at AS "occurrence_starts_at?",
            occurrence.ends_at AS "occurrence_ends_at?",
            occurrence.start_date AS "occurrence_start_date?",
            occurrence.end_date AS "occurrence_end_date?"
        FROM calendar_events event
        LEFT JOIN LATERAL (
            SELECT
                instance.occurrence_key,
                instance.starts_at,
                instance.ends_at,
                instance.start_date,
                instance.end_date
            FROM calendar_event_occurrences instance
            CROSS JOIN LATERAL (
                SELECT COALESCE(
                    instance.starts_at,
                    instance.start_date::timestamp AT TIME ZONE 'UTC'
                ) AS at
            ) instance_start
            WHERE instance.event_id = event.id
              AND NOT instance.is_cancelled
            ORDER BY
                (instance_start.at >= $3) DESC,
                CASE WHEN instance_start.at >= $3 THEN instance_start.at END ASC,
                instance_start.at DESC,
                instance.occurrence_key
            LIMIT 1
        ) occurrence ON true
        WHERE event.id = ANY($2)
          AND (
                event.owner_id = $1
                OR EXISTS (
                    SELECT 1
                    FROM macro_user_links link
                    WHERE link.link_id = event.source_link_id
                      AND link.primary_macro_id = $1
                )
          )
        "#,
        requester_id,
        event_ids,
        now,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.id,
                CalendarEventSearchInfo {
                    id: row.id,
                    owner_id: row.owner_id,
                    title: row.title,
                    status: row.status,
                    starts_at: row.starts_at,
                    ends_at: row.ends_at,
                    start_date: row.start_date,
                    end_date: row.end_date,
                    time_zone: row.time_zone,
                    is_recurring: row.is_recurring,
                    conference_url: row.conference_url,
                    organizer_email: row.organizer_email,
                    organizer_name: row.organizer_name,
                    description: row.description,
                    is_read_only: row.is_read_only,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    occurrence_key: row.occurrence_key,
                    occurrence_starts_at: row.occurrence_starts_at,
                    occurrence_ends_at: row.occurrence_ends_at,
                    occurrence_start_date: row.occurrence_start_date,
                    occurrence_end_date: row.occurrence_end_date,
                },
            )
        })
        .collect())
}
