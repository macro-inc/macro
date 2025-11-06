use super::Client;

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

impl Client for AnthropicClient {
    async fn chat_stream(
        &self,
        request: async_openai::types::CreateChatCompletionRequest,
        extensions: Option<super::RequestExtensions>,
    ) -> anyhow::Result<async_openai::types::ChatCompletionResponseStream> {
        if extensions.is_some() {
            tracing::warn!("extensions are not yet supported");
        }
        Ok(self.inner.chat().create_stream_openai(request).await)
    }
}
