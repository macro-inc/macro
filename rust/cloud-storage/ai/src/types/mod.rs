mod client;
mod error;
mod message;
mod model;
mod providers;
mod request;
mod request_builder;
mod response;

pub use client::{
    AnthropicClient, ExtendedClient, ExtendedOpenAIStream, ExtendedOpenAIStreamItem,
    OpenRouterClient, anthropic, noop, openrouter, traits,
};
pub use error::{AiError, Result};
pub use message::{
    AssistantMessagePart, ChatMessage, ChatMessageContent, ChatMessages, MessageBuilder, NoContent,
    NoRole, Role, SystemPrompt, ToolResponseMessage, UserMessagePart,
};
pub use model::{Model, ModelMetadata, ModelWithMetadataAndProvider, Provider, constants};
pub(crate) use providers::*;
pub use request::ChatCompletionRequest;
pub use request_builder::{NotSet, RequestBuilder};
pub use response::{
    ChatCompletionError, ChatStreamCompletionContent, ChatStreamCompletionResponse,
    ConversionError, Usage,
};
