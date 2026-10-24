//! Who an event's channel shares reach. Shares stay in `entity_access`; the
//! event's own status and visibility decide whether they grant anything, the
//! same rule `entity_access` applies when someone opens the event.

use super::*;

/// Whether channel members the event is shared with can see it now.
pub(super) async fn channel_visible(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
) -> Result<bool, rootcause::Report> {
    let visible = sqlx::query_scalar!(
        r#"
        SELECT (status <> 'cancelled' AND visibility IN ('default', 'public')) AS "visible!"
        FROM calendar_events
        WHERE id = $1
        "#,
        event_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(report)?;
    Ok(visible.unwrap_or(false))
}

/// Current members of the channels the event is shared with, other than its
/// owner.
pub(super) async fn channel_viewers(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
) -> Result<Vec<String>, rootcause::Report> {
    sqlx::query_scalar!(
        r#"
        SELECT DISTINCT participant.user_id
        FROM entity_access grant_row
        JOIN comms_channel_participants participant
          ON participant.channel_id::text = grant_row.source_id
         AND participant.left_at IS NULL
        JOIN calendar_events event ON event.id = grant_row.entity_id
        WHERE grant_row.entity_id = $1
          AND grant_row.entity_type = 'calendar_event'
          AND grant_row.source_type = 'channel'
          AND participant.user_id <> event.owner_id
        ORDER BY participant.user_id
        "#,
        event_id,
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(report)
}

/// Current members of the channels the event is shared with, other than its
/// owner, while it is still visible to them; empty once it is not.
pub(super) async fn visible_channel_viewers(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
) -> Result<Vec<String>, rootcause::Report> {
    sqlx::query_scalar!(
        r#"
        SELECT DISTINCT participant.user_id
        FROM entity_access grant_row
        JOIN comms_channel_participants participant
          ON participant.channel_id::text = grant_row.source_id
         AND participant.left_at IS NULL
        JOIN calendar_events event ON event.id = grant_row.entity_id
        WHERE grant_row.entity_id = $1
          AND grant_row.entity_type = 'calendar_event'
          AND grant_row.source_type = 'channel'
          AND event.status <> 'cancelled'
          AND event.visibility IN ('default', 'public')
          AND participant.user_id <> event.owner_id
        ORDER BY participant.user_id
        "#,
        event_id,
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(report)
}
