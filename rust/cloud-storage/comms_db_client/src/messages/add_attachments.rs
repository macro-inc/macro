use anyhow::Result;
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
    if attachments.is_empty() {
        return Ok(vec![]);
    }

    let ids: Vec<Uuid> = attachments
        .iter()
        .map(|_| macro_uuid::generate_uuid_v7())
        .collect();

    let entity_types: Vec<String> = attachments.iter().map(|a| a.entity_type.clone()).collect();
    let entity_ids: Vec<String> = attachments.iter().map(|a| a.entity_id.clone()).collect();
    let widths: Vec<Option<i32>> = attachments.iter().map(|a| a.width).collect();
    let heights: Vec<Option<i32>> = attachments.iter().map(|a| a.height).collect();

    let created_attachments = sqlx::query_as!(
        Attachment,
        r#"
        INSERT INTO comms_attachments (id, message_id, channel_id, entity_type, entity_id, width, height)
        SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::uuid[], $4::varchar[], $5::varchar[], $6::int[], $7::int[])
        RETURNING
            id,
            message_id,
            channel_id,
            entity_type,
            entity_id,
            width,
            height,
            created_at
        "#,
        &ids as &[Uuid],
        &vec![*message_id; attachments.len()] as &[Uuid],
        &vec![*channel_id; attachments.len()] as &[Uuid],
        &entity_types as &[String],
        &entity_ids as &[String],
        &widths as &[Option<i32>],
        &heights as &[Option<i32>]
    )
        .fetch_all(db)
        .await?;

    Ok(created_attachments)
}
