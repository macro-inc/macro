use crate::model::Message;
use anyhow::{Context, Result};
use sqlx::{Executor, Postgres};
use uuid::Uuid;

#[derive(Debug)]
pub struct CreateMessageOptions {
    pub channel_id: Uuid,
    pub sender_id: String,
    pub content: String,
    pub thread_id: Option<Uuid>,
}

#[tracing::instrument(skip(executor))]
pub async fn create_message<'e, E>(executor: E, options: CreateMessageOptions) -> Result<Message>
where
    E: Executor<'e, Database = Postgres>,
{
    let message_id = macro_uuid::generate_uuid_v7();

    let message = sqlx::query_as!(
        Message,
        r#"
        INSERT INTO comms_messages (id, channel_id, sender_id, content, thread_id)
        VALUES ($1, $2, $3, $4, $5)
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
        message_id,
        options.channel_id,
        options.sender_id,
        options.content,
        options.thread_id
    )
    .fetch_one(executor)
    .await
    .context("unable to create message")?;

    Ok(message)
}
