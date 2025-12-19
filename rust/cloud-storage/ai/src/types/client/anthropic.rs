use super::{ExtendedClient, ExtendedOpenAIStreamItem};
use crate::{
    tool::types::{StreamPart, ToolCall, ToolResponse},
    types::AiError,
};
use anthropic::openai::{
    request::AnthropicRequestExtensions,
    stream_extension::{AnthropicResponseExtension, ExtendedAnthropicStreamItem},
};
use futures::StreamExt;

#[derive(Clone, Debug)]
pub struct AnthropicClient {
    inner: anthropic::client::Client,
}

impl AnthropicClient {
    pub fn new() -> Self {
        let client = anthropic::client::Client::dangerously_try_from_env();
        Self { inner: client }
    }
}

impl Default for AnthropicClient {
    fn default() -> Self {
        Self::new()
    }
}

impl From<ExtendedAnthropicStreamItem> for ExtendedOpenAIStreamItem<AnthropicResponseExtension> {
    fn from(value: ExtendedAnthropicStreamItem) -> Self {
        match value {
            ExtendedAnthropicStreamItem::Extension(ext) => ExtendedOpenAIStreamItem::Extension(ext),
            ExtendedAnthropicStreamItem::OpenAI(oai) => ExtendedOpenAIStreamItem::Response(oai),
        }
    }
}

impl ExtendedClient for AnthropicClient {
    type RequestExtension = AnthropicRequestExtensions;
    type ResponseExtension = AnthropicResponseExtension;

    async fn chat_stream(
        &self,
        request: async_openai::types::CreateChatCompletionRequest,
        extensions: &Self::RequestExtension,
    ) -> anyhow::Result<super::traits::ExtendedOpenAIStream<Self::ResponseExtension>, AiError> {
        Ok(Box::pin(
            self.inner
                .chat()
                .create_stream_openai_extended(request, extensions)
                .await
                .map(|f| f.map(ExtendedOpenAIStreamItem::from)),
        ))
    }

    // TODO: this is incomplete
    // The request must be updated to record the call / response to correctly save / load chat
    // This won't be hit until extensions are enabled in the next pr
    fn handle_extension_item(
        &self,
        _: &mut async_openai::types::CreateChatCompletionRequest,
        item: Self::ResponseExtension,
    ) -> Option<crate::tool::types::StreamPart> {
        match item {
            AnthropicResponseExtension::Citation(_) => None,
            AnthropicResponseExtension::ServerToolUse(tool_call) => {
                Some(StreamPart::ToolCall(ToolCall {
                    id: tool_call.id,
                    json: serde_json::Value::Null,
                    name: tool_call.name,
                }))
            }
            AnthropicResponseExtension::WebSearchToolResponse(response) => {
                Some(StreamPart::ToolResponse(ToolResponse::Json {
                    id: "searchington".into(),
                    json: serde_json::to_value(&response.content).unwrap(),
                    name: "web-search".into(),
                }))
            }
        }
    }
}
