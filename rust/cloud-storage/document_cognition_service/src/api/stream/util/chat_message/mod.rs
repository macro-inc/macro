pub mod ai_request;
pub mod toolset;

use crate::model::chats::ChatResponse;
use crate::{
    api::{context::ApiContext, utils::search},
    model::stream::SendChatMessagePayload,
};

use macro_db_client::dcs::create_chat_message::create_chat_message;

use ai::types::Model;
use ai::types::Role;
use ai::types::{ChatMessage, ChatMessageContent};
use anyhow::{Context, Result};
use model::chat::{NewAttachment, NewChatMessage};
use std::sync::Arc;

// Stores the incoming user message in the database
#[tracing::instrument(err, skip(ctx, chat, incoming_message), fields(chat_id=?incoming_message.chat_id))]
pub async fn store_incoming_message(
    ctx: Arc<ApiContext>,
    user_id: &str,
    chat: &ChatResponse,
    model: Model,
    incoming_message: &SendChatMessagePayload,
) -> Result<String> {
    let created_at = chrono::Utc::now();
    let new_chat_message = NewChatMessage {
        id: None,
        content: ChatMessageContent::Text(incoming_message.content.clone()),
        role: Role::User,
        // Attach the current chat attachments to the user message
        attachments: incoming_message.attachments.as_ref().map(|attachments| {
            attachments
                .iter()
                .cloned()
                .map(|attachment| NewAttachment {
                    attachment_id: attachment.attachment_id,
                    attachment_type: attachment.attachment_type,
                })
                .collect()
        }),
        created_at,
        updated_at: created_at,
        model,
    };

    let user_message_id =
        create_chat_message(ctx.db.clone(), &incoming_message.chat_id, new_chat_message)
            .await
            .context("failed to create chat message")?;

    // Send chat message for search processing
    search::send_chat_message_to_search(
        &ctx,
        &chat.id,
        &user_message_id,
        user_id,
        created_at,
        created_at, // updated_at = created_at
    );

    Ok(user_message_id)
}

/// Stores multiple conversation messages to the database.
/// If `first_message_id` is provided, the first assistant message will use that ID.
#[tracing::instrument(err, skip(ctx, messages), fields(chat_id=?chat_id, message_count=messages.len()))]
pub async fn store_conversation_messages(
    ctx: Arc<ApiContext>,
    user_id: &str,
    chat_id: &str,
    messages: Vec<ChatMessage>,
    model: Model,
    first_message_id: Option<String>,
) -> Result<Vec<String>> {
    if messages.is_empty() {
        return Ok(vec![]);
    }

    let mut message_ids = Vec::new();
    let mut first_id_used = false;

    let created_at = chrono::Utc::now();

    for message in messages {
        // Use the pre-generated ID for the first assistant message
        let id = if !first_id_used && message.role == Role::Assistant {
            first_id_used = true;
            first_message_id.clone()
        } else {
            None
        };

        let new_chat_message = model::chat::NewChatMessage {
            id,
            content: message.content,
            role: message.role,
            attachments: None, // New messages from streaming don't have attachments (they are asssistant messages)
            model,
            created_at,
            updated_at: created_at,
        };

        let message_id = create_chat_message(ctx.db.clone(), chat_id, new_chat_message)
            .await
            .context("failed to create chat message")?;

        message_ids.push(message_id.clone());

        // Send each message for search processing
        search::send_chat_message_to_search(
            &ctx,
            chat_id,
            &message_id,
            user_id,
            created_at,
            created_at, // updated_at = created_at
        );
    }

    Ok(message_ids)
}
