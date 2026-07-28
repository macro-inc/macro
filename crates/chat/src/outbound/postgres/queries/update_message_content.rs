//! Query to update a chat message's content.

use agent::types::ChatMessageContent;
use sqlx::PgPool;

/// Update a message and optionally bump its chat when the message exists.
#[tracing::instrument(err, skip(pool, content))]
pub(crate) async fn update_message_content(
    pool: &PgPool,
    chat_id: &str,
    message_id: &str,
    content: &ChatMessageContent,
    bump_chat_recency: bool,
) -> anyhow::Result<()> {
    let content_json = serde_json::to_value(content)?;
    let mut tx = pool.begin().await?;

    let result = sqlx::query!(
        r#"
        UPDATE "ChatMessage"
        SET "content" = $1, "updatedAt" = NOW()
        WHERE "id" = $2 AND "chatId" = $3
        "#,
        content_json,
        message_id,
        chat_id
    )
    .execute(tx.as_mut())
    .await?;

    if bump_chat_recency && result.rows_affected() > 0 {
        super::patch_chat::patch_chat(&mut tx, chat_id, None, None).await?;
    }

    tx.commit().await?;
    Ok(())
}
