//! Query to fetch a resolved user message.

use crate::domain::models::ResolvedMessagePart;
use sqlx::PgPool;

/// Fetch the resolved representation of a user message, if it exists.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_resolved_message(
    pool: &PgPool,
    message_id: &str,
) -> anyhow::Result<Option<Vec<ResolvedMessagePart>>> {
    let row = sqlx::query!(
        r#"
        SELECT "content"
        FROM "ResolvedUserMessage"
        WHERE "messageId" = $1
        "#,
        message_id
    )
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => {
            let parts = serde_json::from_value::<Vec<ResolvedMessagePart>>(row.content)?;
            Ok(Some(parts))
        }
        None => Ok(None),
    }
}
