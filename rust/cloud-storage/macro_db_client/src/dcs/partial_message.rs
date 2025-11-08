use ai::types::{ChatMessageContent, Role};
use sqlx::{Postgres, Transaction};
use std::str::FromStr;

/// Creates a partial message record with specific content (used on disconnect/interrupt)
#[tracing::instrument(skip(transaction, content), err)]
pub async fn create_partial_message(
    transaction: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    role: Role,
    content: &ChatMessageContent,
    model: Option<String>,
) -> anyhow::Result<String> {
    // Create partial message with the provided content
    let message = sqlx::query!(
        r#"
            INSERT INTO "ChatMessage" ("chatId", "content", "role", "model", "isPartial")
            VALUES ($1, $2, $3, $4, true)
            RETURNING id;
        "#,
        chat_id,
        serde_json::to_value(content)?,
        role.as_ref(),
        model
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(message.id)
}

/// Updates a partial message with new content
#[tracing::instrument(skip(transaction, content), err)]
pub async fn update_partial_message(
    transaction: &mut Transaction<'_, Postgres>,
    message_id: &str,
    content: &ChatMessageContent,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            UPDATE "ChatMessage"
            SET "content" = $1, "updatedAt" = NOW()
            WHERE id = $2 AND "isPartial" = true
        "#,
        serde_json::to_value(content)?,
        message_id
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Finalizes a partial message by setting isPartial to false
#[tracing::instrument(skip(transaction), err)]
pub async fn finalize_partial_message(
    transaction: &mut Transaction<'_, Postgres>,
    message_id: &str,
    final_content: &ChatMessageContent,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            UPDATE "ChatMessage"
            SET "content" = $1, "updatedAt" = NOW(), "isPartial" = false
            WHERE id = $2
        "#,
        serde_json::to_value(final_content)?,
        message_id
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Removes partial messages for a chat (cleanup on abort/disconnect)
#[tracing::instrument(skip(transaction), err)]
pub async fn cleanup_partial_messages(
    transaction: &mut Transaction<'_, Postgres>,
    chat_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            DELETE FROM "ChatMessage"
            WHERE "chatId" = $1 AND "isPartial" = true
        "#,
        chat_id
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Gets all partial messages for a chat (for recovery on reconnection)
#[tracing::instrument(skip(transaction), err)]
pub async fn get_partial_messages(
    transaction: &mut Transaction<'_, Postgres>,
    chat_id: &str,
) -> anyhow::Result<Vec<(String, ChatMessageContent, Role)>> {
    let messages = sqlx::query!(
        r#"
            SELECT id, content, role
            FROM "ChatMessage"
            WHERE "chatId" = $1 AND "isPartial" = true
            ORDER BY "createdAt"
        "#,
        chat_id
    )
    .fetch_all(transaction.as_mut())
    .await?;

    let mut result = Vec::new();
    for message in messages {
        let content: ChatMessageContent = serde_json::from_value(message.content)?;
        let role = Role::from_str(&message.role)?;
        result.push((message.id, content, role));
    }

    Ok(result)
}
