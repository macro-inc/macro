//! Query to update a chat message's content.

use ai::types::ChatMessageContent;
use sqlx::PgPool;

/// Update the content of a specific message, scoped to the chat.
#[tracing::instrument(err, skip(pool, content))]
pub(crate) async fn update_message_content(
    pool: &PgPool,
    chat_id: &str,
    message_id: &str,
    content: &ChatMessageContent,
) -> anyhow::Result<()> {
    let content_json = serde_json::to_value(content)?;

    sqlx::query!(
        r#"
        UPDATE "ChatMessage"
        SET "content" = $1, "updatedAt" = NOW()
        WHERE "id" = $2 AND "chatId" = $3
        "#,
        content_json,
        message_id,
        chat_id
    )
    .execute(pool)
    .await?;

    Ok(())
}
