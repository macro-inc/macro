/* Non-streaming chat completion via Anthropic */
use crate::types::{AnthropicClient, ChatCompletionError, ChatCompletionRequest, ExtendedClient};
use async_openai::types::CreateChatCompletionRequest;
use futures::StreamExt;

#[tracing::instrument(skip(request), fields(model=?request.model, message_count=?request.messages.len()))]
pub async fn get_chat_completion(
    request: ChatCompletionRequest,
) -> Result<String, ChatCompletionError> {
    let openai_request: CreateChatCompletionRequest = request
        .try_into()
        .map_err(ChatCompletionError::RequestError)?;

    collect_anthropic_stream(openai_request).await
}

pub async fn get_chat_completion_openai_request(
    request: CreateChatCompletionRequest,
) -> Result<String, ChatCompletionError> {
    collect_anthropic_stream(request).await
}

async fn collect_anthropic_stream(
    request: CreateChatCompletionRequest,
) -> Result<String, ChatCompletionError> {
    let client = AnthropicClient::default();
    let mut stream = client
        .chat_stream(request)
        .await
        .map_err(|e| ChatCompletionError::RequestError(e.into()))?;

    let mut content = String::new();

    while let Some(item) = stream.next().await {
        let item = item?;
        if let crate::types::ExtendedOpenAIStreamItem::Response(response) = item {
            for choice in response.choices {
                if let Some(text) = choice.delta.content {
                    content.push_str(&text);
                }
                if let Some(refusal) = choice.delta.refusal {
                    return Err(ChatCompletionError::Refusal(refusal));
                }
            }
        }
    }

    if content.is_empty() {
        return Err(ChatCompletionError::NoContent);
    }

    Ok(content)
}
