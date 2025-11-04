use reqwest::header::HeaderMap;

const ANTHROPIC_ROUTER_BASE_URL: &str = "https://api.anthropic.com";
const ANTHROPIC_API_KEY: &str = "ANTHROPIC_API_KEY";

#[derive(Debug, Clone, Default)]
pub struct Config {
    pub api_base: String,
    pub headers: HeaderMap,
}

impl Config {
    pub fn dangrously_try_from_env() -> Self {
        let api_key = std::env::var(ANTHROPIC_API_KEY).expect("api key");
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
