use crate::model::{Attachment, Message};

use anyhow::{Context, Result};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[tracing::instrument(skip(db))]
pub async fn patch_message(
    db: &Pool<Postgres>,
    message_id: Uuid,
    content: &str,
) -> Result<Message> {
    let message = sqlx::query!(
        r#"
        UPDATE comms_messages
        SET content = $1, updated_at = NOW(), edited_at = NOW()
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
        content,
        message_id
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
    .fetch_one(db)
    .await
    .context("unable to update message")?;

    Ok(message)
}

#[tracing::instrument(skip(db))]
pub async fn patch_message_attachments(
    db: &Pool<Postgres>,
    message_id: Uuid,
    attachments: Vec<Attachment>,
) -> Result<Message> {
    let has_attachments = !attachments.is_empty();
    let message = sqlx::query!(
        r#"
        UPDATE comms_messages
        SET 
            updated_at = NOW(),
            edited_at = NOW(),
            deleted_at = CASE 
                WHEN $2 = false AND (content IS NULL OR content ~ '^[\s]*$') THEN NOW()
                ELSE deleted_at
            END
        WHERE id = $1
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
        has_attachments
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
    .fetch_one(db)
    .await
    .context("unable to update message")?;
    Ok(message)
}
