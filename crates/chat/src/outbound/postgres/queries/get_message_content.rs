//! Query to fetch a single message's content by ID, scoped to a chat.

use agent::types::ChatMessageContent;
use sqlx::PgPool;

/// Fetch the content of a single message by ID, scoped to the given chat.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_message_content(
    pool: &PgPool,
    chat_id: &str,
    message_id: &str,
) -> anyhow::Result<ChatMessageContent> {
    let row = sqlx::query!(
        r#"
        SELECT content
        FROM "ChatMessage"
        WHERE "id" = $1 AND "chatId" = $2
        "#,
        message_id,
        chat_id
    )
    .fetch_one(pool)
    .await?;

    let content = serde_json::from_value::<ChatMessageContent>(row.content)?;
    Ok(content)
}
