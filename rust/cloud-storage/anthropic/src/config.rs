use macro_env_var::env_var;
use reqwest::header::HeaderMap;

const ANTHROPIC_ROUTER_BASE_URL: &str = "https://api.anthropic.com";

#[derive(Debug, Clone, Default)]
pub struct Config {
    pub api_base: String,
    pub headers: HeaderMap,
}

env_var! {
    pub struct AnthropicApiKey;
}

impl Config {
    pub fn dangrously_try_from_env() -> Self {
        let api_key = AnthropicApiKey::new().expect("api key");
        let mut headers = HeaderMap::new();
        headers.insert("x-api-key", api_key.parse().expect("good config"));
        headers.insert(
            "anthropic-version",
            "2023-06-01".parse().expect("good version"),
        );
        Self {
            api_base: ANTHROPIC_ROUTER_BASE_URL.into(),
            headers,
        }
    }
}
