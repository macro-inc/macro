use crate::{core::constants::DEFAULT_MAX_TOKENS, model::stream::SendChatMessagePayload};

use crate::model::chats::ChatResponse;

use ai::types::{ChatCompletionRequest, MessageBuilder, RequestBuilder};
use anyhow::Result;
use attachment::{AttachmentContent, AttachmentPart, Attachments, FormattedParts, TextOrImage};
use model_entity::EntityType;
use non_empty::NonEmpty;

#[tracing::instrument(
    skip(chat, incoming_message, static_system_prompt, resolved_parts),
    err
)]
pub fn build_chat_completion_request(
    chat: &ChatResponse,
    incoming_message: &SendChatMessagePayload,
    static_system_prompt: &str,
    user_memory: Option<&str>,
    resolved_parts: Vec<FormattedParts>,
) -> Result<ChatCompletionRequest> {
    let attachments = merge_formatted_parts_to_attachments(resolved_parts);

    let mut messages = chat
        .messages
        .iter()
        .map(|message| {
            MessageBuilder::new()
                .content(message.content.clone())
                .role(message.role)
                .build()
        })
        .collect::<Vec<_>>();

    messages.push(
        MessageBuilder::new()
            .user()
            .content(incoming_message.content.clone())
            .build(),
    );

    let additional_instructions = incoming_message
        .additional_instructions
        .as_deref()
        .unwrap_or_default();

    let mut system_prompt = format!("{}\n{}", static_system_prompt, additional_instructions);

    if let Some(memory) = user_memory {
        system_prompt.push_str("\n\n<user_memory>\n");
        system_prompt.push_str(memory);
        system_prompt.push_str("\n</user_memory>");
    }

    let mut builder = RequestBuilder::new()
        .model(incoming_message.model)
        .messages(messages)
        .system_prompt(system_prompt)
        .max_tokens(DEFAULT_MAX_TOKENS);

    if let Some(attachments) = attachments {
        builder = builder.attachments(attachments);
    }

    Ok(builder.build())
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
