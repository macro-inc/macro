use crate::model::Message;
use anyhow::{Context, Result};
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
    let messages = sqlx::query_as!(
        Message,
        r#"
        SELECT
            id,
            channel_id,
            sender_id,
            content,
            created_at,
            updated_at,
            thread_id,
            edited_at as "edited_at: chrono::DateTime<chrono::Utc>",
            deleted_at as "deleted_at: chrono::DateTime<chrono::Utc>"
        FROM comms_messages
        WHERE channel_id = $1
        AND ($2::timestamptz IS NULL OR created_at >= $2)
        ORDER BY created_at ASC
        LIMIT $3
        "#,
        channel_id,
        since,
        limit
    )
    .fetch_all(db)
    .await
    .context("unable to get messages")?;

    Ok(messages)
}

/// Paginated query to get all messages and their channel id
/// Used for backfilling search
#[tracing::instrument(skip(db))]
pub async fn get_channel_messages(
    db: &Pool<Postgres>,
    limit: i64,
    offset: i64,
) -> Result<Vec<(Uuid, Uuid)>> {
    let messages = sqlx::query!(
        r#"
        SELECT
            channel_id,
            id
        FROM comms_messages
        ORDER BY created_at ASC
        LIMIT $1
        OFFSET $2
        "#,
        limit,
        offset
    )
    .map(|row| (row.channel_id, row.id))
    .fetch_all(db)
    .await
    .context("unable to get messages")?;

    Ok(messages)
}
