use crate::{
    api::context::ApiContext, core::constants::DEFAULT_MAX_TOKENS,
    model::stream::SendChatMessagePayload, service::attachment::fetch,
};

use crate::model::chats::ChatResponse;

use ai::types::{ChatCompletionRequest, MessageBuilder, RequestBuilder};
use anyhow::{Context, Result};
use attachment::{AttachmentContent, AttachmentPart, Attachments, image::ImageData};
use chat::domain::models::{ImageContent, ResolvedMessagePart};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use non_empty::NonEmpty;
use std::sync::Arc;

/// Resolve attachments from external services into [`ResolvedMessagePart`]s.
#[tracing::instrument(skip(ctx, attachments, jwt), err)]
pub async fn resolve_attachments(
    ctx: &ApiContext,
    attachments: &[model::chat::ChatAttachmentWithName],
    jwt: &str,
    user_id: MacroUserIdStr<'static>,
) -> Result<Vec<ResolvedMessagePart>> {
    fetch::fetchium(ctx.scribe.clone(), attachments.to_vec(), jwt, user_id)
        .await
        .context("failed to fetch attachment content")
}

#[tracing::instrument(
    skip(chat, incoming_message, static_system_prompt, resolved_parts),
    err
)]
pub fn build_chat_completion_request(
    chat: &ChatResponse,
    incoming_message: &SendChatMessagePayload,
    static_system_prompt: &str,
    user_memory: Option<&str>,
    resolved_parts: Vec<ResolvedMessagePart>,
) -> Result<ChatCompletionRequest> {
    let attachments = resolved_parts_to_attachments(resolved_parts);

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

fn resolved_parts_to_attachments(parts: Vec<ResolvedMessagePart>) -> Option<Attachments<'static>> {
    let contents: Vec<_> = parts
        .into_iter()
        .map(|part| Ok(resolved_part_to_content(part)))
        .collect();

    NonEmpty::new(contents).ok().map(Attachments::new)
}

fn resolved_part_to_content(part: ResolvedMessagePart) -> AttachmentContent<'static> {
    match part {
        ResolvedMessagePart::Attachment { name, parts } => {
            let attachment_parts: Vec<AttachmentPart<'static>> = parts
                .into_iter()
                .map(resolved_part_to_attachment_part)
                .collect();

            AttachmentContent {
                reference: EntityType::Document.with_entity_string(String::new()),
                name: Some(name),
                content: NonEmpty::new(attachment_parts)
                    .ok()
                    .expect("attachment must have at least one part"),
            }
        }
        ResolvedMessagePart::Text { content } => AttachmentContent {
            reference: EntityType::Document.with_entity_string(String::new()),
            name: None,
            content: NonEmpty::new(vec![AttachmentPart::Content(content)])
                .ok()
                .expect("single element"),
        },
        ResolvedMessagePart::Image(img) => AttachmentContent {
            reference: EntityType::StaticFile.with_entity_string(String::new()),
            name: None,
            content: NonEmpty::new(vec![AttachmentPart::Image(image_content_to_data(img))])
                .ok()
                .expect("single element"),
        },
    }
}

fn resolved_part_to_attachment_part(part: ResolvedMessagePart) -> AttachmentPart<'static> {
    match part {
        ResolvedMessagePart::Text { content } => AttachmentPart::Content(content),
        ResolvedMessagePart::Image(img) => AttachmentPart::Image(image_content_to_data(img)),
        ResolvedMessagePart::Attachment { name, parts } => {
            let content =
                resolved_part_to_content(ResolvedMessagePart::Attachment { name, parts });
            AttachmentPart::Child(Box::new(Ok(content)))
        }
    }
}

fn image_content_to_data(img: ImageContent) -> ImageData {
    match img {
        ImageContent::StaticUrl { url } => ImageData::StaticUrl(url),
        ImageContent::Base64 { data } => ImageData::try_base64_from_string(data)
            .unwrap_or_else(|_| ImageData::StaticUrl(String::new())),
    }
}
