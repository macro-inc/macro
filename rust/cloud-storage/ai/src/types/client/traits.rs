use crate::tool::StreamPart;
use crate::types::AiError;
use anyhow::Result;
use async_openai::error::OpenAIError;
use async_openai::types::chat::{CreateChatCompletionRequest, CreateChatCompletionStreamResponse};
use futures::Stream;
use std::fmt::Debug;
use std::future::Future;
use std::pin::Pin;

#[derive(Debug, Clone)]
pub enum ExtendedOpenAIStreamItem<T: Send + Debug> {
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
    type ResponseExtension: Send + Sync + Clone + Debug + 'static;
    fn chat_stream(
        &self,
        request: CreateChatCompletionRequest,
    ) -> impl Future<Output = Result<ExtendedOpenAIStream<Self::ResponseExtension>, AiError>> + Send;

    fn handle_extension_item(&self, item: Self::ResponseExtension) -> Option<StreamPart>;
}
