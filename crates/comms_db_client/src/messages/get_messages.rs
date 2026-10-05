use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// One channel message and its stable search-backfill pagination key.
#[derive(Debug)]
pub struct ChannelMessageBackfillRow {
    /// Owning channel (non-channel messages are excluded).
    pub channel_id: Uuid,
    /// Message to publish to search.
    pub message_id: Uuid,
    /// Original creation timestamp; ID breaks ties between messages.
    pub created_at: DateTime<Utc>,
}

/// Enumerate channel messages in stable `(created_at, id)` order.
///
/// `None` includes all channels, while `Some(&[])` includes none. Each page is
/// a fresh read, not a snapshot: history committed behind the cursor requires
/// another scoped run after the import commits. Repeating a run is safe because
/// downstream indexing upserts by message ID.
#[tracing::instrument(skip(db), err)]
pub async fn get_channel_messages_for_search_backfill(
    db: &Pool<Postgres>,
    limit: i64,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    channel_ids: Option<&[Uuid]>,
    only_deleted: Option<bool>,
) -> Result<Vec<ChannelMessageBackfillRow>> {
    let (created_at, message_id) = cursor.unzip();
    sqlx::query_as!(
        ChannelMessageBackfillRow,
        r#"
        SELECT channel_id AS "channel_id!", id AS message_id, created_at
        FROM comms_messages
        WHERE channel_id IS NOT NULL
          AND ($2::timestamptz IS NULL OR (created_at, id) > ($2, $3::uuid))
          AND ($4::uuid[] IS NULL OR channel_id = ANY($4))
          AND (
              $5::bool IS NULL
              OR ($5 AND deleted_at IS NOT NULL)
              OR (NOT $5 AND deleted_at IS NULL)
          )
        ORDER BY created_at ASC, id ASC
        LIMIT $1
        "#,
        limit,
        created_at,
        message_id,
        channel_ids,
        only_deleted,
    )
    .fetch_all(db)
    .await
    .context("unable to get channel messages for search backfill")
}

#[cfg(test)]
mod test;

/// Paginated query to get all messages and their channel id
/// Used for backfilling search
#[tracing::instrument(skip(db))]
pub async fn get_channel_messages(
    db: &Pool<Postgres>,
    limit: i64,
    offset: i64,
    only_deleted: Option<bool>,
) -> Result<Vec<(Uuid, Uuid)>> {
    let messages = sqlx::query!(
        r#"
        SELECT
            parent_entity_id::uuid AS "channel_id!",
            id
        FROM comms_messages
        WHERE parent_entity_type = 'channel'
        AND (
            $3::bool IS NULL
            OR ($3 AND deleted_at IS NOT NULL)
            OR (NOT $3 AND deleted_at IS NULL)
        )
        ORDER BY created_at ASC
        LIMIT $1
        OFFSET $2
        "#,
        limit,
        offset,
        only_deleted,
    )
    .map(|row| (row.channel_id, row.id))
    .fetch_all(db)
    .await
    .context("unable to get messages")?;

    Ok(messages)
}
