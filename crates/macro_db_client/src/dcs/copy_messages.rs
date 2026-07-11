use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn copy_messages(
    db: Pool<Postgres>,
    source_chat_id: &str,
    dest_chat_id: &str,
) -> anyhow::Result<String> {
    let mut transaction: sqlx::Transaction<'_, Postgres> = db.begin().await?;
    sqlx::query!(
        r#"
        INSERT INTO "ChatMessage" ("chatId", "createdAt", "updatedAt", "content", "role", "model")
        SELECT $1, "createdAt", "updatedAt", "content", "role", "model"
        FROM "ChatMessage"
        WHERE "chatId"=$2
    "#,
        dest_chat_id,
        source_chat_id
    )
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "copy message transaction error");
        anyhow::Error::from(e)
    })?;
    Ok(dest_chat_id.to_owned())
}
