use ai::types::ChatMessageContent;
use anyhow::Result;
use sqlx::{Executor, Postgres};

/// A chat message with only the fields needed for tool operations.
pub struct ToolMessage {
    pub id: String,
    pub content: ChatMessageContent,
}

/// Fetches all messages for a chat, returning only id and content.
#[tracing::instrument(err, skip(db))]
pub async fn get_chat_messages<'e, T>(db: T, chat_id: &str) -> Result<Vec<ToolMessage>>
where
    T: Executor<'e, Database = Postgres>,
{
    let rows = sqlx::query!(
        r#"
        SELECT id, content
        FROM "ChatMessage"
        WHERE "chatId" = $1
        ORDER BY "createdAt" ASC
        "#,
        chat_id
    )
    .fetch_all(db)
    .await?;

    rows.into_iter()
        .map(|row| {
            let content = serde_json::from_value::<ChatMessageContent>(row.content)?;
            Ok(ToolMessage {
                id: row.id,
                content,
            })
        })
        .collect()
}

/// Updates the content of a specific chat message.
#[tracing::instrument(err, skip(db, content))]
pub async fn update_message_content<'e, T>(
    db: T,
    message_id: &str,
    content: &ChatMessageContent,
) -> Result<()>
where
    T: Executor<'e, Database = Postgres>,
{
    let content_json = serde_json::to_value(content)?;

    sqlx::query!(
        r#"
        UPDATE "ChatMessage"
        SET "content" = $1, "updatedAt" = NOW()
        WHERE "id" = $2
        "#,
        content_json,
        message_id
    )
    .execute(db)
    .await?;

    Ok(())
}
