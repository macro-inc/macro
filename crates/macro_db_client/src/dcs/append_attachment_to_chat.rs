use model::StringID;
use model::chat::{AttachmentType, NewChatAttachment};
use model_entity::EntityType;
use sqlx::{Postgres, Transaction};

fn attachment_type_to_entity_type(at: &AttachmentType) -> EntityType {
    match at {
        AttachmentType::Document => EntityType::Document,
        AttachmentType::Image => EntityType::StaticFile,
        AttachmentType::Channel => EntityType::Channel,
        AttachmentType::Email => EntityType::EmailThread,
        AttachmentType::Project => EntityType::Project,
    }
}

#[tracing::instrument(skip(transaction))]
async fn add_attachment(
    transaction: &mut Transaction<'_, Postgres>,
    new_attachment: NewChatAttachment,
) -> anyhow::Result<String> {
    let entity_id = uuid::Uuid::parse_str(&new_attachment.attachment_id)?;
    let attachment = sqlx::query_as!(
        StringID,
        r#"
            INSERT INTO "ChatAttachment" ("entity_type", "entity_id", "chatId")
            VALUES ($1, $2, $3)
            RETURNING id;
        "#,
        attachment_type_to_entity_type(&new_attachment.attachment_type).to_string(),
        entity_id,
        new_attachment.chat_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(attachment.id)
}

#[tracing::instrument(skip(transaction))]
pub async fn append_attachment_to_chat(
    transaction: &mut Transaction<'_, Postgres>,
    attachment: NewChatAttachment,
) -> anyhow::Result<()> {
    // Update chat updatedAt
    sqlx::query!(
        r#"
        UPDATE "Chat" SET "updatedAt" = NOW()
        WHERE id = $1
        "#,
        attachment.chat_id,
    )
    .execute(&mut **transaction)
    .await?;

    add_attachment(transaction, attachment).await?;
    Ok(())
}
