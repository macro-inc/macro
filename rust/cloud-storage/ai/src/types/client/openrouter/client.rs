use super::config::OpenRouterConfig;
use crate::types::client::traits::{Client, RequestExtensions};
use crate::types::{Model, ModelWithMetadataAndProvider, AiError};

use anyhow::Context;
use async_openai::Client as OpenAiClient;
use async_openai::types::CreateChatCompletionRequest;

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

impl OpenRouterClient {
    pub fn preprocess_request(
        &self,
        mut request: CreateChatCompletionRequest,
    ) -> CreateChatCompletionRequest {
        let model = serde_json::from_str::<Model>(&request.model).unwrap_or(Model::Gemini20Flash);
        let model_str = format!("{}/{}", model.provider(), model);
        request.model = model_str;
        request
    }
}

impl Client for OpenRouterClient {
    async fn chat_stream(
        &self,
        request: async_openai::types::CreateChatCompletionRequest,
        extensions: Option<RequestExtensions>,
    ) -> Result<async_openai::types::ChatCompletionResponseStream, AiError> {
        let request = self.preprocess_request(request);
        let request = if let Some(ext) = extensions {
            self.extend_request(request, ext)
        } else {
            serde_json::to_value(request).context("failed to jsonfiy request")
        }?;
        self.inner
            .chat()
            .create_stream_byot(request)
            .await
            .map_err(AiError::from)
    }
}
