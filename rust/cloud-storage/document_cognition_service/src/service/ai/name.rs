use anyhow::{Context, Result};
use std::fmt::Write;

use crate::{
    api::context::ApiContext, core::constants::DEFAULT_MAX_TOKENS, service::get_chat::get_chat,
};

use ai::chat_completion::get_chat_completion_openai_request;
use async_openai::types::{
    ChatCompletionRequestSystemMessageArgs, CreateChatCompletionRequestArgs,
};
use macro_db_client::dcs::patch_chat::patch_chat;

#[tracing::instrument(skip(text), err)]
pub async fn get_recomended_chat_name(text: &str) -> anyhow::Result<String> {
    let system_message = ChatCompletionRequestSystemMessageArgs::default()
        .content("Given the following text from a conversation, please generate a 1-4 word title for the conversation. DO NOT USE MARKDOWN FORMATTING.")
        .build()
        .context("failed to build system message")?
        .into();

    let user_message = ChatCompletionRequestSystemMessageArgs::default()
        .content(text)
        .build()
        .context("failed to build user message")?
        .into();

    let request = CreateChatCompletionRequestArgs::default()
        .model(ai::types::Model::Gemini20Flash.to_string())
        .max_tokens(DEFAULT_MAX_TOKENS)
        .messages(vec![system_message, user_message])
        .build()
        .context("failed to build chat completion request")?;

    let response = get_chat_completion_openai_request(request)
        .await
        .context("failed to create chat completion")?;

    Ok(response)
}

#[tracing::instrument(skip(ctx), err)]
pub async fn maybe_rename_chat(chat_id: &str, ctx: &ApiContext, user_id: &str) -> Result<String> {
    let updated_messages = get_chat(ctx, chat_id, user_id)
        .await
        .context("failed to get chat")?
        .messages;
    // Double check that we have a system, user and assistant message
    let mut content = String::new();

    for message in updated_messages {
        if let Some(text) = message.conent_text_with_tools() {
            let _ = write!(content, "[{}]", message.role);
            let _ = writeln!(content, "{}", text);
        }
    }

    let new_name = get_recomended_chat_name(&content).await?;
    patch_chat(&ctx.db, chat_id, Some(&new_name), None, None, None)
        .await
        .context("failed to patch chat with new name")?;
    Ok(new_name)
}
