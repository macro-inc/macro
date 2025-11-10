// biohazard
use crate::api::context::ApiContext;
use crate::core::model::{CHAT_MODELS, FALLBACK_MODEL};
use crate::model::chats::ChatResponse;
use ai::model_selection::ModelSelection;
use ai::{model_selection::select_model, types::Model};
use anyhow::Context;
use macro_db_client::dcs::get_chat::{
    get_chat_db, get_messages, get_web_citations, raw_attachments,
};
use macro_db_client::dcs::get_document_name_and_type::get_document_name_and_type;
use model::chat::{AttachmentMetadata, AttachmentType, ChatAttachmentWithName};
use std::str::FromStr;
use unfurl_service::GetUnfurlResponse;

#[tracing::instrument(err, skip(ctx))]
pub async fn get_chat(
    ctx: &ApiContext,
    chat_id: &str,
    current_user_id: &str,
) -> anyhow::Result<ChatResponse> {
    let chat = get_chat_db(&ctx.db, chat_id)
        .await
        .context("Failed to get chat from database")?;
    let db = &ctx.db.clone();
    let raw_attachments = raw_attachments(&ctx.db, chat_id)
        .await
        .context("Failed to get raw attachments")?;
    // Get the document names for all the attachments
    let mut attachments: Vec<ChatAttachmentWithName> = Vec::new();
    for attachment in raw_attachments {
        let metadata = match attachment.attachment_type {
            AttachmentType::Image => {
                get_document_name_and_type(db.clone(), &attachment.attachment_id)
                    .await
                    .map(|(image_name, image_extension)| AttachmentMetadata::Image {
                        image_name,
                        image_extension,
                    })
                    .ok()
            }
            AttachmentType::Document => {
                get_document_name_and_type(db.clone(), &attachment.attachment_id)
                    .await
                    .map(
                        |(document_name, document_type)| AttachmentMetadata::Document {
                            document_type,
                            document_name,
                        },
                    )
                    .ok()
            }
            AttachmentType::Channel => ctx
                .scribe
                .channel
                .get_channel_metadata(attachment.attachment_id.as_str(), None)
                .await
                .map(|channel_metadata| AttachmentMetadata::Channel {
                    channel_name: channel_metadata.name,
                    channel_type: channel_metadata.channel_type,
                })
                .ok(),
            AttachmentType::Email => {
                let thread = ctx
                    .scribe
                    .email
                    .get_email_messages_by_thread_id(&attachment.attachment_id, 0, 1, None)
                    .await;

                thread
                    .map(|thread| {
                        thread
                            .first()
                            .and_then(|first| first.subject.clone())
                            .unwrap_or("No Subject".into())
                    })
                    .map(|subject| AttachmentMetadata::Email {
                        email_subject: subject,
                    })
                    .ok()
            }
        };
        attachments.push(ChatAttachmentWithName {
            attachment_type: attachment.attachment_type,
            attachment_id: attachment.attachment_id,
            metadata,
            id: attachment.id.clone(),
        });
    }

    let messages = get_messages(&ctx.db, chat_id, attachments.as_slice())
        .await
        .context("Failed to get messages")?;

    let model = chat
        .model
        .map(|m| Model::from_str(&m).unwrap_or(FALLBACK_MODEL));

    let model_selection = select_model(None, chat.token_count.unwrap_or(0), CHAT_MODELS.to_vec())
        .unwrap_or_else(|_| ModelSelection {
            available_models: vec![],
            new_model: None,
        });

    let web_citations = get_web_citations(&ctx.db, chat_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(k, v)| {
            (
                k,
                v.into_iter()
                    .map(|v| GetUnfurlResponse {
                        description: v.description,
                        favicon_url: v.favicon_url,
                        image_url: v.image_url,
                        title: v.title,
                        url: v.url,
                    })
                    .collect(),
            )
        })
        .collect();

    #[allow(deprecated)]
    Ok(ChatResponse {
        id: chat.id,
        user_id: chat.user_id,
        name: chat.name,
        model,
        messages,
        project_id: chat.project_id,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
        attachments,
        token_count: chat.token_count,
        available_models: model_selection.available_models,
        web_citations,
        is_persistent: chat.is_persistent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("chat_example")))]
    /// chat three has 2 messages,
    /// it has 0 active attachments
    /// but message-one has 3 message attachments
    async fn test_get_chat(pool: Pool<Postgres>) {
        let ctx = crate::api::context::test_api_context(pool.clone()).await;
        let chat = get_chat(&ctx, "chat-three", "user").await.unwrap();

        assert_eq!(chat.id, "chat-three".to_string());
        assert_eq!(chat.user_id, "macro|user@user.com".to_string());
        assert_eq!(chat.name, "test-chat 3".to_string());
        assert!(chat.model.is_some(), "some model");

        assert_eq!(chat.messages.len(), 2);
        assert_eq!(chat.messages[0].attachments.len(), 3);
    }
}
