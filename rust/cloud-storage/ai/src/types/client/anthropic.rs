use super::{ExtendedClient, ExtendedOpenAIStreamItem};
use crate::{
    tool::{StreamPart, ToolResponse, types::ToolCall},
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
    extensions: AnthropicRequestExtensions,
}

impl AnthropicClient {
    pub fn new(extensions: AnthropicRequestExtensions) -> Self {
        let client = anthropic::client::Client::dangerously_try_from_env();
        Self {
            inner: client,
            extensions,
        }
    }
}

impl Default for AnthropicClient {
    fn default() -> Self {
        Self::new(AnthropicRequestExtensions(vec![]))
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
    type ResponseExtension = AnthropicResponseExtension;
    async fn chat_stream(
        &self,
        request: async_openai::types::CreateChatCompletionRequest,
    ) -> anyhow::Result<super::traits::ExtendedOpenAIStream<Self::ResponseExtension>, AiError> {
        Ok(Box::pin(
            self.inner
                .chat()
                .create_stream_openai_extended(request, &self.extensions)
                .await
                .map(|f| f.map(ExtendedOpenAIStreamItem::from)),
        ))
    }

    fn handle_extension_item(&self, item: Self::ResponseExtension) -> Option<StreamPart> {
        match item {
            AnthropicResponseExtension::Citation(_) => None,
            AnthropicResponseExtension::ServerToolUse(tool_call) => {
                Some(StreamPart::ToolCall(ToolCall {
                    id: tool_call.id,
                    json: tool_call.input,
                    name: tool_call.name,
                }))
            }
            AnthropicResponseExtension::WebSearchToolResponse(response) => {
                let id = response.tool_use_id.clone();
                let json = serde_json::to_value(&response).ok()?;

                Some(StreamPart::ToolResponse(ToolResponse::Json {
                    id,
                    json,
                    name: "web_search".into(),
                }))
            }
        }
    }
}
