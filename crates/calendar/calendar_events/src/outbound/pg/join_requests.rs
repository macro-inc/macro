//! Requests to join calendar events shared with a channel.

use super::*;
use crate::domain::join_requests::{CalendarJoinRequest, CalendarJoinRequestStatus};

struct JoinRequestRow {
    id: Uuid,
    event_id: Uuid,
    requester_id: String,
    requester_email: String,
    status: String,
    created_at: DateTime<Utc>,
}

impl From<JoinRequestRow> for CalendarJoinRequest {
    fn from(row: JoinRequestRow) -> Self {
        Self {
            id: row.id,
            event_id: row.event_id,
            requester_id: row.requester_id,
            requester_email: row.requester_email,
            status: CalendarJoinRequestStatus::from_db(&row.status),
            created_at: row.created_at,
        }
    }
}

pub(super) async fn open_join_request(
    pool: &PgPool,
    event_id: Uuid,
    requester_id: &str,
    requester_email: &str,
) -> Result<(CalendarJoinRequest, bool), Report> {
    // An existing request, pending, accepted or declined, is left as it is:
    // only the first ask inserts, so `opened` is true only for that call.
    let row = sqlx::query_as!(
        JoinRequestRow,
        r#"
        INSERT INTO calendar_event_join_requests
            (id, event_id, requester_id, requester_email, status)
        VALUES ($1, $2, $3, $4, 'pending')
        ON CONFLICT (event_id, requester_id) DO NOTHING
        RETURNING id, event_id, requester_id, requester_email, status, created_at
        "#,
        Uuid::now_v7(),
        event_id,
        requester_id,
        requester_email,
    )
    .fetch_optional(pool)
    .await
    .map_err(report)?;
    if let Some(row) = row {
        return Ok((row.into(), true));
    }
    // The request already exists; asking again changes nothing.
    let existing = find_join_request(pool, event_id, requester_id)
        .await?
        .ok_or_else(|| rootcause::report!("join request vanished during the ask"))?;
    Ok((existing, false))
}

pub(super) async fn find_join_request(
    pool: &PgPool,
    event_id: Uuid,
    requester_id: &str,
) -> Result<Option<CalendarJoinRequest>, Report> {
    sqlx::query_as!(
        JoinRequestRow,
        r#"
        SELECT id, event_id, requester_id, requester_email, status, created_at
        FROM calendar_event_join_requests
        WHERE event_id = $1 AND requester_id = $2
        "#,
        event_id,
        requester_id,
    )
    .fetch_optional(pool)
    .await
    .map(|row| row.map(Into::into))
    .map_err(report)
}

pub(super) async fn list_pending_join_requests(
    pool: &PgPool,
    event_id: Uuid,
) -> Result<Vec<CalendarJoinRequest>, Report> {
    sqlx::query_as!(
        JoinRequestRow,
        r#"
        SELECT id, event_id, requester_id, requester_email, status, created_at
        FROM calendar_event_join_requests
        WHERE event_id = $1 AND status = 'pending'
        ORDER BY created_at, id
        "#,
        event_id,
    )
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(Into::into).collect())
    .map_err(report)
}

pub(super) async fn get_join_request(
    pool: &PgPool,
    request_id: Uuid,
) -> Result<Option<CalendarJoinRequest>, Report> {
    sqlx::query_as!(
        JoinRequestRow,
        r#"
        SELECT id, event_id, requester_id, requester_email, status, created_at
        FROM calendar_event_join_requests
        WHERE id = $1
        "#,
        request_id,
    )
    .fetch_optional(pool)
    .await
    .map(|row| row.map(Into::into))
    .map_err(report)
}

pub(super) async fn resolve_join_request(
    pool: &PgPool,
    request_id: Uuid,
    status: CalendarJoinRequestStatus,
) -> Result<Option<CalendarJoinRequest>, Report> {
    sqlx::query_as!(
        JoinRequestRow,
        r#"
        UPDATE calendar_event_join_requests
        SET status = $2, resolved_at = now()
        WHERE id = $1
          AND (status = 'pending' OR ($2 = 'accepted' AND status = 'declined'))
        RETURNING id, event_id, requester_id, requester_email, status, created_at
        "#,
        request_id,
        status.as_str(),
    )
    .fetch_optional(pool)
    .await
    .map(|row| row.map(Into::into))
    .map_err(report)
}
