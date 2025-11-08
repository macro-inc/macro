/* Non-streaming chat completion */
use crate::types::OpenRouterClient;
use crate::types::{ChatCompletionError, ChatCompletionRequest};
use anyhow::Result;
use async_openai::types::CreateChatCompletionRequest;
use async_openai::{Client, config::Config};
use tracing::instrument;

#[instrument(skip_all, err)]
pub(crate) async fn get_openai_chat_completion<
    C: Config,
    T: std::ops::Deref<Target = Client<C>>,
>(
    client: T,
    request: CreateChatCompletionRequest,
) -> Result<String, ChatCompletionError> {
    let response = client.chat().create(request).await?;

    let message = response
        .choices
        .into_iter()
        .next()
        .ok_or(ChatCompletionError::NoContent)?
        .message;

    if let Some(refusal) = message.refusal {
        Err(ChatCompletionError::Refusal(refusal))
    } else if let Some(content) = message.content {
        return Ok(content);
    } else {
        return Err(ChatCompletionError::NoContent);
    }
}

#[tracing::instrument(skip(request), fields(model=?request.model, message_count=?request.messages.len()))]
pub async fn get_chat_completion(
    request: ChatCompletionRequest,
) -> Result<String, ChatCompletionError> {
    let openai_request: CreateChatCompletionRequest = request
        .try_into()
        // TODO this causes a request error before the request is actually made. RequestError says
        // "/// The request was rejected by the provider" so this seems wrong.
        .map_err(ChatCompletionError::RequestError)?;

    let client = OpenRouterClient::new();
    get_openai_chat_completion(client, openai_request).await
}

pub async fn get_chat_completion_openai_request(
    request: CreateChatCompletionRequest,
) -> Result<String, ChatCompletionError> {
    // Streaming OpenAI models directly via OpenAI
    let client = OpenRouterClient::new();
    get_openai_chat_completion(client, request).await
}
