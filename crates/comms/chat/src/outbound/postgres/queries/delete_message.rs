//! Delete a chat message by ID.

use sqlx::PgPool;

/// Delete a message, returning its parent chat ID or an error if it does not exist.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn delete_message(pool: &PgPool, message_id: &str) -> anyhow::Result<String> {
    let row = sqlx::query!(
        r#"
        DELETE FROM "ChatMessage"
        WHERE id = $1
        RETURNING "chatId" as "chat_id!"
        "#,
        message_id
    )
    .fetch_one(pool)
    .await?;

    Ok(row.chat_id)
}
