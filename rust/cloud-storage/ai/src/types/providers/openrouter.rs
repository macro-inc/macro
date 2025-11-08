use anyhow::{Context, Result};
use async_openai::config::Config;
use lazy_static::lazy_static;
use reqwest::header::{AUTHORIZATION, HeaderMap};
use secrecy::{ExposeSecret, SecretBox, SecretString};

lazy_static! {
    static ref OPEN_ROUTER_CONFIG: OpenRouterConfig = try_from_env()
        .context("Failed to load OpenRouter Config")
        .unwrap();
}

const OPEN_ROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const OPEN_ROUTER_API_KEY: &str = "OPEN_ROUTER_API_KEY";

fn try_from_env() -> Result<OpenRouterConfig> {
    let api_key = std::env::var(OPEN_ROUTER_API_KEY).context(OPEN_ROUTER_API_KEY)?;
    let boxed_key = Box::new(api_key);
    let secret = SecretBox::new(boxed_key.into_boxed_str());
    Ok(OpenRouterConfig { api_key: secret })
}

#[derive(Clone, Debug)]
pub struct OpenRouterConfig {
    api_key: SecretString,
}

impl Default for OpenRouterConfig {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenRouterConfig {
    pub fn new() -> Self {
        OPEN_ROUTER_CONFIG.clone()
    }
}

impl Config for OpenRouterConfig {
    fn api_base(&self) -> &str {
        OPEN_ROUTER_BASE_URL
    }

    fn api_key(&self) -> &SecretString {
        &self.api_key
    }

    fn headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            format!("Bearer {}", self.api_key.expose_secret())
                .as_str()
                .parse()
                .unwrap(),
        );
        headers
    }

    fn query(&self) -> Vec<(&str, &str)> {
        vec![]
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", OPEN_ROUTER_BASE_URL, path)
    }
}
