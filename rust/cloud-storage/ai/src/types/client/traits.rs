use crate::tool::types::StreamPart;
use crate::types::AiError;
use anyhow::Result;
use async_openai::error::OpenAIError;
use async_openai::types::{CreateChatCompletionRequest, CreateChatCompletionStreamResponse};
use futures::Stream;
use std::future::Future;
use std::pin::Pin;

pub enum ExtendedOpenAIStreamItem<T: Send> {
    /// A standard OpenAI compatible item
    Response(CreateChatCompletionStreamResponse),
    /// A client-defined item
    Extension(T),
}

pub type ExtendedOpenAIStream<T> =
    Pin<Box<dyn Stream<Item = Result<ExtendedOpenAIStreamItem<T>, OpenAIError>> + Send>>;

/// A client that is openai compatible may implement this trait.
/// Extension items may be used to support non-openai compatible featuture (ie server tools)
pub trait ExtendedClient {
    type RequestExtension: Send;
    type ResponseExtension: Send;
    fn chat_stream(
        &self,
        request: CreateChatCompletionRequest,
        extensions: &Self::RequestExtension,
    ) -> impl Future<Output = Result<ExtendedOpenAIStream<Self::ResponseExtension>, AiError>> + Send;

    fn handle_extension_item(
        &self,
        request: &mut CreateChatCompletionRequest,
        item: Self::ResponseExtension,
    ) -> Option<StreamPart>;
}
