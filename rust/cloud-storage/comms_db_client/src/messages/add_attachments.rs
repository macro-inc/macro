use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::model::{Attachment, NewAttachment};

#[tracing::instrument(skip(db))]
pub async fn add_attachments_to_message(
    db: &Pool<Postgres>,
    message_id: &Uuid,
    channel_id: &Uuid,
    attachments: Vec<NewAttachment>,
) -> Result<Vec<Attachment>> {
    let mut created_attachments: Vec<Attachment> = vec![];

    for attachment in attachments {
        let attachment_id = macro_uuid::generate_uuid_v7();
        let new_attachment = sqlx::query_as!(
            Attachment,
            r#"
            INSERT INTO comms_attachments (id, message_id, channel_id, entity_type, entity_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING
                id,
                message_id,
                channel_id,
                entity_type,
                entity_id,
                created_at
            "#,
            attachment_id,
            message_id,
            channel_id,
            attachment.entity_type,
            attachment.entity_id,
        )
        .fetch_one(db)
        .await
        .context("unable to create attachment")?;

        created_attachments.push(new_attachment);
    }

    Ok(created_attachments)
}
