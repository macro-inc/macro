use super::Client;
use crate::types::AiError;

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

impl Client for AnthropicClient {
    async fn chat_stream(
        &self,
        request: async_openai::types::CreateChatCompletionRequest,
        extensions: Option<super::RequestExtensions>,
    ) -> Result<async_openai::types::ChatCompletionResponseStream, AiError> {
        if extensions.is_some() {
            tracing::warn!("extensions are not yet supported");
        }
        Ok(self.inner.chat().create_stream_openai(request).await)
    }
}
