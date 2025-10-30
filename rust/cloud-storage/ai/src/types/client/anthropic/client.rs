use std::ops::Deref;

use super::config::AnthropicConfig;
use async_openai::Client;

#[derive(Clone)]
pub struct AnthropicClient {
    inner: Client<AnthropicConfig>,
}

impl AnthropicClient {
    pub fn new() -> Self {
        Self {
            inner: Client::with_config(AnthropicConfig::new()),
        }
    }
}

impl Deref for AnthropicClient {
    type Target = Client<AnthropicConfig>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}
