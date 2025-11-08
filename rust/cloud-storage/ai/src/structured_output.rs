use anyhow::{Context, Result};
use async_openai::types::{
    ChatCompletionRequestSystemMessage, ChatCompletionRequestUserMessage,
    CreateChatCompletionRequestArgs, ResponseFormat, ResponseFormatJsonSchema,
};

use serde_json::Value;

use crate::{constants::DEFAULT_MAX_TOKENS, types::Model, types::OpenRouterClient};

pub async fn structured_output_completion(
    user_request: &str,
    system_prompt: &str,
    schema: Value,
    schema_name: &str,
) -> Result<String> {
    let client = OpenRouterClient::new();

    let json_schema = ResponseFormatJsonSchema {
        description: None,
        name: schema_name.to_string(),
        schema: Some(schema),
        strict: Some(true),
    };

    let response_format = ResponseFormat::JsonSchema { json_schema };

    let request = CreateChatCompletionRequestArgs::default()
        .max_tokens(DEFAULT_MAX_TOKENS)
        .model(Model::Gemini20FlashLite.to_string())
        .messages([
            ChatCompletionRequestSystemMessage::from(system_prompt).into(),
            ChatCompletionRequestUserMessage::from(user_request).into(),
        ])
        .response_format(response_format)
        .build()?;

    let response = client.chat().create(request).await?;

    let first_choice = response.choices.first().context("no choices found")?;

    if let Some(content) = &first_choice.message.content {
        return Ok(content.to_string());
    }

    Err(anyhow::anyhow!("no content found"))
}
