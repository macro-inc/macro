use crate::model::Message;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

//TODO: should add pagination
#[tracing::instrument(skip(db))]
pub async fn get_messages(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
    since: Option<chrono::DateTime<chrono::Utc>>,
    limit: Option<i64>,
) -> Result<Vec<Message>> {
    let messages = sqlx::query!(
        r#"
        SELECT
            id,
            channel_id AS "channel_id!",
            sender_id,
            content,
            created_at,
            updated_at,
            thread_id,
            edited_at as "edited_at: chrono::DateTime<chrono::Utc>",
            deleted_at as "deleted_at: chrono::DateTime<chrono::Utc>"
        FROM (
            SELECT *
            FROM comms_messages
            WHERE channel_id = $1
            AND ($2::timestamptz IS NULL OR created_at >= $2)
            ORDER BY created_at DESC
            LIMIT $3
        ) AS latest_messages
        ORDER BY created_at ASC
        "#,
        channel_id,
        since,
        limit
    )
    .try_map(|row| {
        Ok(Message {
            id: row.id,
            channel_id: row.channel_id,
            thread_id: row.thread_id,
            sender_id: MacroUserIdStr::parse_from_str(&row.sender_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at,
            edited_at: row.edited_at,
            deleted_at: row.deleted_at,
        })
    })
    .fetch_all(db)
    .await
    .context("unable to get messages")?;

    Ok(messages)
}

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
            channel_id AS "channel_id!",
            id
        FROM comms_messages
        WHERE channel_id IS NOT NULL
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
