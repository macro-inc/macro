use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

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
