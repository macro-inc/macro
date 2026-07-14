use crate::model::stream::SendChatMessagePayload;

use crate::model::chats::ChatResponse;

use agent::types::{ChatMessage, ChatMessageContent, Role};
use anyhow::Result;
use attachment::{AttachmentContent, AttachmentPart, Attachments, FormattedParts, TextOrImage};
use model_entity::EntityType;
use non_empty::NonEmpty;

#[tracing::instrument(skip(chat, incoming_message, resolved_parts), err)]
pub fn build_chat_messages(
    chat: &ChatResponse,
    incoming_message: &SendChatMessagePayload,
    resolved_parts: Vec<FormattedParts>,
) -> Result<Vec<ChatMessage>> {
    let attachments = merge_formatted_parts_to_attachments(resolved_parts);

    let mut messages: Vec<ChatMessage> = chat
        .messages
        .iter()
        .map(|message| ChatMessage {
            role: message.role,
            content: message.content.clone(),
            attachments: None,
        })
        .collect();

    messages.push(ChatMessage {
        role: Role::User,
        content: ChatMessageContent::Text(incoming_message.content.clone()),
        attachments,
    });

    Ok(messages)
}

fn merge_formatted_parts_to_attachments(
    all_parts: Vec<FormattedParts>,
) -> Option<Attachments<'static>> {
    let contents: Vec<_> = all_parts
        .into_iter()
        .flat_map(|parts| parts.into_parts().into_inner())
        .map(|part| {
            let (attachment_part, entity_type) = match part {
                TextOrImage::Text(text) => (AttachmentPart::Content(text), EntityType::Document),
                TextOrImage::Image(data) => (AttachmentPart::Image(data), EntityType::StaticFile),
            };
            Ok(AttachmentContent {
                reference: entity_type.with_entity_string(String::new()),
                name: None,
                content: NonEmpty::one(attachment_part),
            })
        })
        .collect();

    NonEmpty::new(contents).ok().map(Attachments::new)
}
