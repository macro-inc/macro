use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

/// Returns a map keyed by message id for every message in `message_ids` that
/// exists in `comms_messages`. The value is the message's `deleted_at`
/// timestamp when soft-deleted, or `None` when active. Message ids absent
/// from the returned map have no row in the database (e.g. hard-deleted or
/// stale OpenSearch entries) and should be treated as not surfacable.
#[tracing::instrument(skip(db))]
pub async fn get_message_deletion_states(
    db: &Pool<Postgres>,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, Option<DateTime<Utc>>>> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT
            id,
            deleted_at::timestamptz as "deleted_at"
        FROM comms_messages
        WHERE id = ANY($1)
        "#,
        message_ids,
    )
    .fetch_all(db)
    .await
    .context("unable to fetch message deletion states")?;

    Ok(rows.into_iter().map(|r| (r.id, r.deleted_at)).collect())
}
