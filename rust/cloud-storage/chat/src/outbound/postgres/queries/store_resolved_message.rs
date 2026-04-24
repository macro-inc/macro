//! Query to upsert a resolved user message.

use crate::domain::models::ResolvedMessagePart;
use sqlx::PgPool;

/// Upsert the resolved representation of a user message.
#[tracing::instrument(err, skip(pool, parts))]
pub(crate) async fn store_resolved_message(
    pool: &PgPool,
    message_id: &str,
    parts: &[ResolvedMessagePart],
) -> anyhow::Result<()> {
    let content = serde_json::to_value(parts)?;

    sqlx::query!(
        r#"
        INSERT INTO "ResolvedUserMessage" ("messageId", "content")
        VALUES ($1, $2)
        ON CONFLICT ("messageId") DO UPDATE SET "content" = $2
        "#,
        message_id,
        content
    )
    .execute(pool)
    .await?;

    Ok(())
}
