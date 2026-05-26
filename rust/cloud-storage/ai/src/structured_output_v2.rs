use crate::traits::Metadata;
use crate::types::{ChatCompletionRequest, OpenRouterClient};
use anyhow::{Context, Result};
use async_openai::types::chat::{
    CreateChatCompletionRequestArgs, ResponseFormat, ResponseFormatJsonSchema,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json;
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DynamicSchema {
    pub schema: serde_json::Value,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// this doesn't work with anything that serialized as "OneOf" / "AnyOf" (enums)
#[tracing::instrument]
pub async fn structured_completion_v2<S>(request: ChatCompletionRequest) -> Result<S>
where
    S: Metadata + JsonSchema,
{
    let request = request.as_structured_request::<S>(false)?;
    let client = OpenRouterClient::new();
    let response = client.chat().create(request).await;

    match response {
        Ok(chat_response) => {
            // Add better error handling here
            if !chat_response.choices.is_empty() {
                for choice in chat_response.choices {
                    if let Some(content) = choice.message.content {
                        return serde_json::from_str::<S>(&content)
                            .map_err(anyhow::Error::from)
                            .context("Unable to deserialize structured output");
                    }
                }
            }
        }
        Err(e) => {
            tracing::error!("API call failed with error: {:?}", e);
            anyhow::bail!("API call failed: {}", e);
        }
    }

    anyhow::bail!("Expected structured response")
}

#[tracing::instrument(skip(request), err)]
pub async fn dynamic_structured_completion(
    request: ChatCompletionRequest,
    schema: DynamicSchema,
) -> Result<serde_json::Value> {
    let response_format = ResponseFormat::JsonSchema {
        json_schema: ResponseFormatJsonSchema {
            description: schema.description,
            name: schema.name,
            schema: Some(schema.schema),
            strict: Some(true),
        },
    };

    let model = request.model();
    let openai_request = CreateChatCompletionRequestArgs::default()
        .model(format!("{}/{}", model.to_provider_model_string().0, model))
        .messages(request.openai_messages())
        .response_format(response_format)
        .build()
        .context("Could not build structured completion request")?;

    let client = OpenRouterClient::new();
    let response = client.chat().create(openai_request).await;

    match response {
        Ok(chat_response) => {
            for choice in chat_response.choices {
                if let Some(content) = choice.message.content {
                    return serde_json::from_str::<serde_json::Value>(&content)
                        .context("Failed to parse structured output as JSON");
                }
            }
            anyhow::bail!("Structured completion returned no content")
        }
        Err(e) => {
            tracing::error!(error=?e, "Structured completion API call failed");
            anyhow::bail!("Structured completion failed: {}", e)
        }
    }
}
