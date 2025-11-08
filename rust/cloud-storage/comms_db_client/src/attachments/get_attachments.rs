use crate::model::Attachment;
use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[tracing::instrument(skip(db))]
pub async fn get_attachments(db: &Pool<Postgres>, channel_id: &Uuid) -> Result<Vec<Attachment>> {
    let messages = sqlx::query_as!(
        Attachment,
        r#"
        SELECT
            id,
            message_id as "message_id: Uuid",
            channel_id as "channel_id: Uuid",
            entity_type,
            entity_id,
            created_at
        FROM comms_attachments
        WHERE channel_id = $1
        ORDER BY created_at ASC
        "#,
        channel_id
    )
    .fetch_all(db)
    .await
    .context("failed to get attachments")?;

    Ok(messages)
}

#[tracing::instrument(skip(db))]
pub async fn get_attachments_by_message_id(
    db: &Pool<Postgres>,
    message_id: Uuid,
) -> Result<Vec<Attachment>> {
    let attachments = sqlx::query_as!(
        Attachment,
        r#"
        SELECT
            id,
            message_id as "message_id: Uuid",
            channel_id as "channel_id: Uuid",
            entity_type,
            entity_id,
            created_at
        FROM comms_attachments
        WHERE message_id = $1"#,
        message_id
    )
    .fetch_all(db)
    .await
    .context("failed to get attachments by message ID")?;

    Ok(attachments)
}
