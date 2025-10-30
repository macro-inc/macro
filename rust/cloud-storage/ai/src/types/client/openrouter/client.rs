use super::config::OpenRouterConfig;
use crate::types::client::client::{Client, RequestExtensions};
use anyhow::Context;
use async_openai::Client as OpenAiClient;

#[derive(Clone)]
pub struct OpenRouterClient {
    inner: OpenAiClient<OpenRouterConfig>,
}

impl OpenRouterClient {
    pub fn new() -> Self {
        OpenRouterClient {
            inner: OpenAiClient::with_config(OpenRouterConfig::new()),
        }
    }
}

impl std::ops::Deref for OpenRouterClient {
    type Target = OpenAiClient<OpenRouterConfig>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl Default for OpenRouterClient {
    fn default() -> Self {
        Self::new()
    }
}

impl Client for OpenRouterClient {
    async fn chat_stream(
        &self,
        request: async_openai::types::CreateChatCompletionRequest,
        extensions: Option<RequestExtensions>,
    ) -> anyhow::Result<async_openai::types::ChatCompletionResponseStream> {
        let request = if let Some(ext) = extensions {
            self.extend_request(request, ext)
        } else {
            serde_json::to_value(request).context("failed to jsonfiy request")
        }?;
        self.inner
            .chat()
            .create_stream_byot(request)
            .await
            .map_err(anyhow::Error::from)
    }
}
