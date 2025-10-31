use anyhow::{Context, Result};
use async_openai::config::Config;
use lazy_static::lazy_static;
use reqwest::header::HeaderMap;
use secrecy::{ExposeSecret, SecretBox, SecretString};

const ANTHROPIC_ROUTER_BASE_URL: &str = "https://api.anthropic.com";
const ANTHROPIC_API_KEY: &str = "ANTHROPIC_API_KEY";

fn try_from_env() -> Result<AnthropicConfig> {
    let api_key =
        std::env::var(ANTHROPIC_API_KEY).context(format!("Load env var {}", ANTHROPIC_API_KEY))?;
    let secret = SecretBox::new(Box::new(api_key).into_boxed_str());
    Ok(AnthropicConfig { api_key: secret })
}

lazy_static! {
    static ref ANTHROPIC_CONFIG: AnthropicConfig =
        try_from_env().expect("Failed to load AnthropicConfig");
}

#[derive(Clone, Debug)]
pub struct AnthropicConfig {
    api_key: SecretString,
}

impl AnthropicConfig {
    pub fn new() -> Self {
        ANTHROPIC_CONFIG.clone()
    }
}

impl Config for AnthropicConfig {
    fn api_base(&self) -> &str {
        ANTHROPIC_ROUTER_BASE_URL
    }
    fn api_key(&self) -> &SecretString {
        &self.api_key
    }

    fn headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-api-key",
            self.api_key
                .expose_secret()
                .parse()
                .expect("anthropic api key header"),
        );
        headers
    }

    fn query(&self) -> Vec<(&str, &str)> {
        vec![]
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", ANTHROPIC_ROUTER_BASE_URL, path)
    }
}
