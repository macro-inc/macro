use crate::traits::Metadata;
use crate::types::{ChatCompletionRequest, OpenRouterClient};
use anyhow::{Context, Result};
use schemars::JsonSchema;
use serde_json;

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
            return Err(anyhow::anyhow!("API call failed: {}", e));
        }
    }

    Err(anyhow::anyhow!("Expected structured response"))
}
