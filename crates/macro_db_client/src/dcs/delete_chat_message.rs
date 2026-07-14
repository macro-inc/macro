use anyhow::Result;
use sqlx::{Executor, Postgres};

#[tracing::instrument(skip(executor))]
pub async fn delete_chat_message<'e, E>(executor: E, message_id: &str) -> Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query!(
        r#"
          DELETE FROM "ChatMessage"
          WHERE id = $1
          RETURNING id
        "#,
        message_id
    )
    .fetch_one(executor)
    .await?;

    Ok(())
}
