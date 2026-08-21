//! Keyset enumeration of calendar events for search backfills.

use chrono::{DateTime, Utc};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// One page entry: enough to enqueue a reindex and build the next cursor.
#[derive(Debug, Clone)]
pub struct CalendarEventBackfillRow {
    pub event_id: Uuid,
    pub updated_at: DateTime<Utc>,
}

/// Walk `calendar_events` in `(updated_at ASC, id ASC)` order.
///
/// Only series masters exist in this table — recurring instances live in
/// `calendar_event_occurrences` and are not indexed — so this enumerates
/// exactly the set the index holds.
///
/// Calendar has no Kafka topic, so this is also the recovery mechanism for a
/// dropped live publish, not just first-time population.
#[tracing::instrument(skip(db), err)]
pub async fn get_calendar_events_for_search_backfill(
    db: &Pool<Postgres>,
    limit: i64,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    updated_after: Option<DateTime<Utc>>,
    updated_before: Option<DateTime<Utc>>,
) -> anyhow::Result<Vec<CalendarEventBackfillRow>> {
    let (cursor_updated_at, cursor_id) = match cursor {
        Some((updated_at, id)) => (Some(updated_at), Some(id)),
        None => (None, None),
    };

    let rows = sqlx::query!(
        r#"
        SELECT
            event.id AS "event_id!",
            event.updated_at AS "updated_at!"
        FROM calendar_events event
        WHERE ($2::timestamptz IS NULL OR $3::uuid IS NULL
               OR (event.updated_at, event.id) > ($2, $3))
          AND ($4::timestamptz IS NULL OR event.updated_at >= $4)
          AND ($5::timestamptz IS NULL OR event.updated_at < $5)
        ORDER BY event.updated_at ASC, event.id ASC
        LIMIT $1
        "#,
        limit,
        cursor_updated_at,
        cursor_id,
        updated_after,
        updated_before,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| CalendarEventBackfillRow {
            event_id: row.event_id,
            updated_at: row.updated_at,
        })
        .collect())
}
