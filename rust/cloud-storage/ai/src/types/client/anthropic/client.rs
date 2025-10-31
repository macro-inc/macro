use async_openai::config::Config;

use super::config::AnthropicConfig;

#[derive(Clone)]
pub struct AnthropicClient {
    config: AnthropicConfig,
    inner: reqwest::Client,
}

impl AnthropicClient {
    pub fn new() -> Self {
        let config = AnthropicConfig::new();
        let client = reqwest::ClientBuilder::new()
            .default_headers(config.headers())
            .build()
            .expect("failed to build anthropic client inner reqwest client");
        Self {
            inner: client,
            config,
        }
    }
}
