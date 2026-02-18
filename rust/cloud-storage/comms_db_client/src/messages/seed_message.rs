use crate::model::Message;
use anyhow::{Context, Result};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::{Executor, Postgres};
use uuid::Uuid;

/// Options for seeding a message with a pre-defined UUID.
#[derive(Debug)]
pub struct SeedMessageOptions {
    /// The pre-defined message UUID.
    pub message_id: Uuid,
    /// The channel to post the message to.
    pub channel_id: Uuid,
    /// The user ID of the message sender.
    pub sender_id: String,
    /// The message content.
    pub content: String,
    /// Optional thread ID if this is a reply.
    pub thread_id: Option<Uuid>,
}

/// Seed a message with a pre-defined UUID.
///
/// Identical to `create_message` but uses the provided `message_id` instead of
/// auto-generating one.
#[tracing::instrument(skip(executor))]
pub async fn seed_message<'e, E>(executor: E, options: SeedMessageOptions) -> Result<Message>
where
    E: Executor<'e, Database = Postgres>,
{
    let message = sqlx::query!(
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
        options.message_id,
        options.channel_id,
        options.sender_id,
        options.content,
        options.thread_id
    )
    .try_map(|row| {
        Ok(Message {
            id: row.id,
            channel_id: row.channel_id,
            thread_id: row.thread_id,
            sender_id: MacroUserIdStr::parse_from_str(&row.sender_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at,
            edited_at: row.edited_at,
            deleted_at: row.deleted_at,
        })
    })
    .fetch_one(executor)
    .await
    .context("unable to create message")?;

    Ok(message)
}
