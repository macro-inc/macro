//! The projection of a calendar event that the search index stores.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// A calendar event series master, flattened for indexing.
#[derive(Debug, Clone)]
pub struct CalendarEventForIndex {
    pub id: Uuid,
    pub owner_id: String,
    /// The inbox link the canonical source belongs to; grants delegates.
    pub source_link_id: Uuid,
    pub ical_uid: String,
    pub title: String,
    pub status: String,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    /// Whether the series carries any recurrence rule.
    pub is_recurring: bool,
    pub organizer_email: Option<String>,
    /// Attendee addresses, lowercased for the keyword filter.
    pub attendee_emails: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Read one event's indexable projection. `None` means the row is gone and the
/// caller should remove it from the index.
#[tracing::instrument(skip(db), err)]
pub async fn get_calendar_event_for_index(
    db: &Pool<Postgres>,
    event_id: Uuid,
) -> anyhow::Result<Option<CalendarEventForIndex>> {
    let row = sqlx::query!(
        r#"
        SELECT
            event.id AS "id!",
            event.owner_id AS "owner_id!",
            event.source_link_id AS "source_link_id!",
            event.ical_uid AS "ical_uid!",
            event.title AS "title!",
            event.status AS "status!",
            event.starts_at,
            event.ends_at,
            event.start_date,
            event.end_date,
            (cardinality(event.recurrence_lines) > 0) AS "is_recurring!",
            event.organizer_email,
            event.created_at AS "created_at!",
            event.updated_at AS "updated_at!",
            COALESCE(
                (
                    SELECT array_agg(lower(attendee.email) ORDER BY lower(attendee.email))
                    FROM calendar_event_attendees attendee
                    WHERE attendee.event_id = event.id
                ),
                '{}'
            ) AS "attendee_emails!"
        FROM calendar_events event
        WHERE event.id = $1
        "#,
        event_id,
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|row| CalendarEventForIndex {
        id: row.id,
        owner_id: row.owner_id,
        source_link_id: row.source_link_id,
        ical_uid: row.ical_uid,
        title: row.title,
        status: row.status,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        start_date: row.start_date,
        end_date: row.end_date,
        is_recurring: row.is_recurring,
        organizer_email: row.organizer_email,
        attendee_emails: row.attendee_emails,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}
