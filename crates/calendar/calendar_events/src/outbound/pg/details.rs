//! The stored details of an event or one of its occurrences, which a guest's
//! update is compared against.

use super::*;

struct DetailsRow {
    title: String,
    description: Option<String>,
    location: Option<String>,
    visibility: String,
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    time_zone: Option<String>,
    recurrence_lines: Vec<String>,
    has_conference: bool,
    has_occurrence: bool,
    override_title: Option<String>,
    override_description: Option<String>,
    override_location: Option<String>,
    occurrence_starts_at: Option<DateTime<Utc>>,
    occurrence_ends_at: Option<DateTime<Utc>>,
    occurrence_start_date: Option<NaiveDate>,
    occurrence_end_date: Option<NaiveDate>,
}

pub(super) async fn event_details(
    pool: &PgPool,
    event_id: Uuid,
    occurrence_key: Option<&str>,
) -> Result<Option<EventDetails>, Report> {
    // An occurrence's time is its materialized instance, else the exception
    // that moved it; its content is the exception's where it has one.
    let row = sqlx::query_as!(
        DetailsRow,
        r#"
        SELECT
            event.title,
            event.description,
            event.location,
            event.visibility,
            event.starts_at,
            event.ends_at,
            event.start_date,
            event.end_date,
            event.time_zone,
            event.recurrence_lines,
            event.conference_url IS NOT NULL AS "has_conference!",
            $2::text IS NOT NULL AS "has_occurrence!",
            override.title AS override_title,
            override.description AS override_description,
            override.location AS override_location,
            CASE WHEN occurrence.event_id IS NULL THEN override.starts_at
                 ELSE occurrence.starts_at END AS occurrence_starts_at,
            CASE WHEN occurrence.event_id IS NULL THEN override.ends_at
                 ELSE occurrence.ends_at END AS occurrence_ends_at,
            CASE WHEN occurrence.event_id IS NULL THEN override.start_date
                 ELSE occurrence.start_date END AS occurrence_start_date,
            CASE WHEN occurrence.event_id IS NULL THEN override.end_date
                 ELSE occurrence.end_date END AS occurrence_end_date
        FROM calendar_events event
        LEFT JOIN calendar_event_occurrences occurrence
            ON occurrence.event_id = event.id
           AND occurrence.occurrence_key = $2
        LEFT JOIN calendar_event_overrides override
            ON override.event_id = event.id
           AND override.recurrence_id = $2
        WHERE event.id = $1
        "#,
        event_id,
        occurrence_key,
    )
    .fetch_optional(pool)
    .await
    .map_err(report)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let time = if row.has_occurrence {
        let stored = (
            row.occurrence_starts_at,
            row.occurrence_ends_at,
            row.occurrence_start_date,
            row.occurrence_end_date,
        );
        match stored {
            (None, None, None, None) => None,
            (starts_at, ends_at, start_date, end_date) => Some(row_time(
                starts_at,
                ends_at,
                start_date,
                end_date,
                row.time_zone,
            )?),
        }
    } else {
        Some(row_time(
            row.starts_at,
            row.ends_at,
            row.start_date,
            row.end_date,
            row.time_zone,
        )?)
    };
    Ok(Some(EventDetails {
        title: row.override_title.unwrap_or(row.title),
        description: row.override_description.or(row.description),
        location: row.override_location.or(row.location),
        visibility: event_visibility(&row.visibility),
        time,
        recurrence_lines: row.recurrence_lines,
        has_conference: row.has_conference,
    }))
}
