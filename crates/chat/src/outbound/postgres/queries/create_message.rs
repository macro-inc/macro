//! Insert a new chat message with optional attachments.

use agent::types::Role;
use model::chat::{AttachmentType, NewChatMessage};
use model_entity::EntityType;
use sqlx::PgPool;

fn attachment_type_to_entity_type(at: &AttachmentType) -> EntityType {
    match at {
        AttachmentType::Document => EntityType::Document,
        AttachmentType::Image => EntityType::StaticFile,
        AttachmentType::Channel => EntityType::Channel,
        AttachmentType::Email => EntityType::EmailThread,
        AttachmentType::Project => EntityType::Project,
    }
}

/// Insert a message into a chat, returning the message ID.
///
/// User messages also insert their attachments in the same transaction.
#[tracing::instrument(err, skip(pool, message))]
pub(crate) async fn create_message(
    pool: &PgPool,
    chat_id: &str,
    message: NewChatMessage,
) -> anyhow::Result<String> {
    let id = message
        .id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let content = serde_json::to_value(&message.content)?;
    let role = message.role.as_ref().to_string();
    let model = message.model.to_string();

    let mut tx = pool.begin().await?;

    let message_id = sqlx::query!(
        r#"
        INSERT INTO "ChatMessage" ("id", "chatId", "content", "role", "model", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
        id,
        chat_id,
        content,
        role,
        model,
        message.created_at.naive_utc(),
        message.updated_at.naive_utc(),
    )
    .fetch_one(&mut *tx)
    .await
    .map(|r| r.id)?;

    if message.role == Role::User {
        let mut kinds = Vec::new();
        let mut ids: Vec<uuid::Uuid> = Vec::new();
        let mut chat_ids = Vec::new();
        let mut message_ids = Vec::new();
        for a in message.attachments.unwrap_or_default() {
            kinds.push(attachment_type_to_entity_type(&a.attachment_type).to_string());
            ids.push(uuid::Uuid::parse_str(&a.attachment_id)?);
            chat_ids.push(chat_id.to_string());
            message_ids.push(message_id.clone());
        }

        if !kinds.is_empty() {
            sqlx::query!(
                r#"
                INSERT INTO "ChatAttachment" ("entity_type", "entity_id", "chatId", "messageId")
                SELECT * FROM UNNEST($1::TEXT[], $2::UUID[], $3::TEXT[], $4::TEXT[])
                "#,
                &kinds,
                &ids,
                &chat_ids,
                &message_ids,
            )
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok(message_id)
}
