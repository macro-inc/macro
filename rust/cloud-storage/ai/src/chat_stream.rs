/* Streaming chat completion */
use crate::types::OpenRouterClient;
use crate::types::{ChatCompletionRequest, ChatStreamCompletionResponse};
use anyhow::{Context, Result};
use async_openai::types::CreateChatCompletionRequest;
use futures::{Stream, StreamExt};
use std::pin::Pin;

pub type ChatStream = Pin<
    Box<
        dyn Stream<Item = Result<Vec<ChatStreamCompletionResponse>, anyhow::Error>>
            + Send
            + 'static,
    >,
>;

#[tracing::instrument(skip(request), fields(model=?request.model, message_count=?request.messages.len()), err)]
pub async fn get_chat_stream(request: ChatCompletionRequest) -> Result<ChatStream> {
    let client = OpenRouterClient::new();
    let mut openai_request: CreateChatCompletionRequest =
        request.try_into().context("into openai_request")?;

    // bastard async_openai feature
    // when the byot feature is enabled create_stream doesn't automatically set this and the api returns an error
    openai_request.stream = Some(true);

    let stream = client
        .chat()
        .create_stream(openai_request)
        .await
        .context("error creating openai stream")?;

    Ok(Box::pin(stream.map(|response| {
        Ok(vec![
            response
                .context("bad request - no stream returned")?
                .try_into()
                .context("unexpected response")?,
        ])
    })))
}
