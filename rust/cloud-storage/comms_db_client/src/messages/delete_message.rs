use crate::model::Message;
use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[tracing::instrument(skip(db))]
pub async fn delete_message(db: &Pool<Postgres>, message_id: Uuid) -> Result<Message> {
    let message = sqlx::query_as!(
        Message,
        r#"
        UPDATE comms_messages
        SET content = $1, updated_at = NOW(), deleted_at = NOW()
        WHERE id = $2
        RETURNING 
            id, 
            channel_id,
            sender_id,
            content, 
            created_at,
            updated_at,
            thread_id,
            edited_at as "edited_at: chrono::DateTime<chrono::Utc>",
            deleted_at as "deleted_at: chrono::DateTime<chrono::Utc>"
        "#,
        "".to_string(),
        message_id
    )
    .fetch_one(db)
    .await
    .context("unable to delete message")?;

    Ok(message)
}
