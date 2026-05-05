use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

/// Returns a map from message id to its deleted_at timestamp for any of the given
/// message ids that have been soft-deleted. Messages that are not deleted are
/// omitted from the map.
#[tracing::instrument(skip(db))]
pub async fn get_messages_deleted_at(
    db: &Pool<Postgres>,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, DateTime<Utc>>> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT
            id,
            deleted_at::timestamptz as "deleted_at!"
        FROM comms_messages
        WHERE id = ANY($1)
            AND deleted_at IS NOT NULL
        "#,
        message_ids,
    )
    .fetch_all(db)
    .await
    .context("unable to fetch message deleted_at timestamps")?;

    Ok(rows.into_iter().map(|r| (r.id, r.deleted_at)).collect())
}
