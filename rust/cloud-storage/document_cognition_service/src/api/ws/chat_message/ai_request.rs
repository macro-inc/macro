use crate::{
    api::context::ApiContext, core::constants::DEFAULT_MAX_TOKENS,
    model::ws::SendChatMessagePayload, service::attachment::fetch,
};

use crate::model::chats::ChatResponse;

use ai::types::{ChatCompletionRequest, MessageBuilder, RequestBuilder};
use anyhow::{Context, Result};
use std::sync::Arc;

// fetch documents then build request
#[tracing::instrument(skip(ctx, chat, incoming_message), err)]
pub async fn build_chat_completion_request(
    ctx: Arc<ApiContext>,
    chat: &ChatResponse,
    incoming_message: &SendChatMessagePayload,
    static_system_prompt: &str,
) -> Result<ChatCompletionRequest> {
    let attachments = fetch::fetchium(
        ctx.scribe.clone(),
        incoming_message.attachments.clone().unwrap_or_default(),
    )
    .await
    .context("failed to fetch attachment content")?;
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

    let system_prompt = format!("{}\n{}", static_system_prompt, additional_instructions);

    Ok(RequestBuilder::new()
        .attachments(attachments)
        .model(incoming_message.model)
        .messages(messages)
        .system_prompt(system_prompt)
        .max_tokens(DEFAULT_MAX_TOKENS)
        .build())
}
