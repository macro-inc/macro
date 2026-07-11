//! Query to fetch a resolved user message.

use attachment::FormattedParts;
use sqlx::PgPool;

/// Fetch the resolved representation of a user message.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_resolved_message(
    pool: &PgPool,
    message_id: &str,
) -> anyhow::Result<FormattedParts> {
    let row = sqlx::query!(
        r#"
        SELECT "content"
        FROM resolved_message_content
        WHERE "messageId" = $1
        "#,
        message_id
    )
    .fetch_one(pool)
    .await?;

    let parts = serde_json::from_value::<FormattedParts>(row.content)?;
    Ok(parts)
}
