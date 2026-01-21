use crate::prelude::ServerToolUse;
use crate::types::response::Citation;
use crate::types::response::code_execution::{
    BashCodeExecutionResponse, TextEditorCodeExecutionResponse,
};
use crate::types::response::web_fetch::WebFetchResponse;
use crate::types::response::web_search::WebSearchResponse;
use async_openai::error::OpenAIError;
use async_openai::types::CreateChatCompletionStreamResponse;
use futures::Stream;
use std::pin::Pin;

/// Items that are returned in an Anthropic stream but not supported by OpenAI
#[derive(Clone, Debug, PartialEq)]
pub enum AnthropicResponseExtension {
    Citation(Citation),
    WebSearchToolResponse(WebSearchResponse),
    WebFetchToolResponse(WebFetchResponse),
    BashCodeExecutionToolResponse(BashCodeExecutionResponse),
    TextEditorCodeExecutionToolResponse(TextEditorCodeExecutionResponse),
    ServerToolUse(ServerToolUse),
}

/// A standard OpenAI response item or an item only sent by Anthropic
#[derive(Clone, Debug, PartialEq)]
pub enum ExtendedAnthropicStreamItem {
    OpenAI(CreateChatCompletionStreamResponse),
    Extension(AnthropicResponseExtension),
}

impl From<CreateChatCompletionStreamResponse> for ExtendedAnthropicStreamItem {
    fn from(value: CreateChatCompletionStreamResponse) -> Self {
        Self::OpenAI(value)
    }
}

impl From<AnthropicResponseExtension> for ExtendedAnthropicStreamItem {
    fn from(value: AnthropicResponseExtension) -> Self {
        Self::Extension(value)
    }
}

/// Full stream type of mixed openai items and anthropic items
pub type ExtendedStream =
    Pin<Box<dyn Stream<Item = Result<ExtendedAnthropicStreamItem, OpenAIError>> + Send>>;
