use agent::types::Role;
use anyhow::Context;
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

#[tracing::instrument(skip(db), err)]
pub async fn create_chat_message(
    db: PgPool,
    chat_id: &str,
    message: NewChatMessage,
) -> Result<String, anyhow::Error> {
    let id = message
        .id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let mut tsx = db.begin().await.context("error creating transaction")?;
    if message.role == Role::User {
        // insert message
        let message_id = sqlx::query!(
            r#"
            INSERT INTO "ChatMessage" ("id", "chatId", "content", "role", "model", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id;
        "#,
            id,
            chat_id,
            serde_json::to_value(&message.content)?,
            message.role.as_ref(),
            &message.model.to_string(),
            message.created_at.naive_utc(),
            message.updated_at.naive_utc(),
        )
            .fetch_one(&mut *tsx)
            .await
            .context("failed to create chat message")
            .map(|record| record.id)?;

        let (kinds, ids, chat_ids, message_ids): (
            Vec<String>,
            Vec<uuid::Uuid>,
            Vec<String>,
            Vec<String>,
        ) = message
            .attachments
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|attachment| {
                let entity_type =
                    attachment_type_to_entity_type(&attachment.attachment_type).to_string();
                let entity_id = uuid::Uuid::parse_str(&attachment.attachment_id).ok()?;
                Some((
                    entity_type,
                    entity_id,
                    chat_id.to_string(),
                    message_id.to_string(),
                ))
            })
            .collect::<(Vec<_>, Vec<_>, Vec<_>, Vec<_>)>();
        // insert attachments for message
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
        .execute(&mut *tsx)
        .await
        .context("failed to insert attachments with message")?;
        tsx.commit().await.context("failed to commit transaction")?;
        Ok(message_id)
    } else {
        let id = sqlx::query!(
            r#"
            INSERT INTO "ChatMessage" ("id", "chatId", "content", "role", "model", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id;
        "#,
            id,
            chat_id,
            serde_json::to_value(&message.content)?,
            message.role.as_ref(),
            &message.model.to_string(),
            message.created_at.naive_utc(),
            message.updated_at.naive_utc(),
        )
        .fetch_one(&mut *tsx)
        .await
        .map(|record| record.id)
        .context("failed to create chat message")?;
        tsx.commit().await.context("failed to commit transaction")?;
        Ok(id)
    }
}
