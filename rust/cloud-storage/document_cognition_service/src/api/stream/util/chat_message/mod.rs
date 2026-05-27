pub mod ai_request;
pub mod toolset;

use crate::model::chats::ChatResponse;
use crate::{
    api::{context::ApiContext, utils::search},
    model::stream::SendChatMessagePayload,
};

use agent::AgentModel;
use agent::types::Role;
use agent::types::{ChatMessage, ChatMessageContent};
use anyhow::{Context, Result};
use chat::domain::models::ResolvedMessageContent;
use chat::domain::ports::MessageService;
use model::chat::{AttachmentType, NewAttachment, NewChatMessage};
use model_entity::EntityType;
use std::sync::Arc;

/// Stores the incoming user message and resolves its attachments in one step.
#[tracing::instrument(err, skip(ctx, chat, incoming_message), fields(chat_id=?incoming_message.chat_id))]
pub async fn store_incoming_message(
    ctx: Arc<ApiContext>,
    user_id: &str,
    chat: &ChatResponse,
    model: AgentModel,
    incoming_message: &SendChatMessagePayload,
) -> Result<ResolvedMessageContent> {
    let created_at = chrono::Utc::now();
    let new_chat_message = NewChatMessage {
        id: None,
        content: ChatMessageContent::Text(incoming_message.content.clone()),
        role: Role::User,
        attachments: incoming_message.attachments.as_ref().map(|attachments| {
            attachments
                .iter()
                .filter_map(|entity| {
                    let attachment_type = match entity.entity_type {
                        EntityType::Document => AttachmentType::Document,
                        EntityType::StaticFile => AttachmentType::Image,
                        EntityType::Channel => AttachmentType::Channel,
                        EntityType::EmailThread => AttachmentType::Email,
                        EntityType::Project => AttachmentType::Project,
                        _ => return None,
                    };
                    Some(NewAttachment {
                        attachment_id: entity.entity_id.clone().into_owned(),
                        attachment_type,
                    })
                })
                .collect()
        }),
        created_at,
        updated_at: created_at,
        model,
    };

    let user_id: macro_user_id::user_id::MacroUserIdStr<'static> =
        user_id.to_owned().try_into().map_err(anyhow::Error::msg)?;
    let resolved = ctx
        .message_service
        .create(&user_id, &incoming_message.chat_id, new_chat_message)
        .await
        .context("failed to create chat message")?;

    search::send_chat_message_to_search(
        &ctx,
        &chat.id,
        &resolved.message_id,
        user_id.as_ref(),
        created_at,
        created_at,
    );

    Ok(resolved)
}

/// Stores multiple conversation messages to the database.
/// If `first_message_id` is provided, the first assistant message will use that ID.
#[tracing::instrument(err, skip(ctx, messages), fields(chat_id=?chat_id, message_count=messages.len()))]
pub async fn store_conversation_messages(
    ctx: Arc<ApiContext>,
    user_id: &str,
    chat_id: &str,
    messages: Vec<ChatMessage>,
    model: AgentModel,
    first_message_id: Option<String>,
) -> Result<Vec<String>> {
    if messages.is_empty() {
        return Ok(vec![]);
    }

    let mut message_ids = Vec::new();
    let mut first_id_used = false;

    let created_at = chrono::Utc::now();

    for message in messages {
        let id = if !first_id_used && message.role == Role::Assistant {
            first_id_used = true;
            first_message_id.clone()
        } else {
            None
        };

        let new_chat_message = NewChatMessage {
            id,
            content: message.content,
            role: message.role,
            attachments: None,
            model,
            created_at,
            updated_at: created_at,
        };

        let message_id = ctx
            .message_service
            .store(chat_id, new_chat_message)
            .await
            .context("failed to create chat message")?;

        message_ids.push(message_id.clone());

        search::send_chat_message_to_search(
            &ctx,
            chat_id,
            &message_id,
            user_id,
            created_at,
            created_at,
        );
    }

    Ok(message_ids)
}
