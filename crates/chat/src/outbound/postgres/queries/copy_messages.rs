//! Copy all messages from one chat to another.

/// Copy all messages from `source_chat_id` into `dest_chat_id`.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn copy_messages(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    source_chat_id: &str,
    dest_chat_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "ChatMessage" ("chatId", "createdAt", "updatedAt", "content", "role", "model")
        SELECT $1, "createdAt", "updatedAt", "content", "role", "model"
        FROM "ChatMessage"
        WHERE "chatId" = $2
        "#,
        dest_chat_id,
        source_chat_id,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}
