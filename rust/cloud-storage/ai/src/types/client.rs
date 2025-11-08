use crate::types::openrouter::OpenRouterConfig;
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
