use super::types::{RequestBody, Response};
use std::env::VarError;

use reqwest;

const PERPLEXITY_API_KEY: &str = "PERPLEXITY_API_KEY";
const PERPLEXITY_ENDPOINT: &str = "https://api.perplexity.ai/chat/completions";

pub struct PerplexityClient {
    inner: reqwest::Client,
}

impl PerplexityClient {
    pub fn new(api_key: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "Authorization",
            format!("Bearer {}", api_key).parse().unwrap(),
        );

        let inner = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        PerplexityClient { inner }
    }

    pub fn from_env() -> Result<Self, VarError> {
        let key = std::env::var(PERPLEXITY_API_KEY)?;
        Ok(Self::new(key))
    }
}

impl PerplexityClient {
    pub async fn simple_search<T: Into<String>>(
        &self,
        query: T,
        system_prompt: T,
    ) -> Result<Response, anyhow::Error> {
        let body = RequestBody::default_query(query.into(), system_prompt.into());
        self.inner
            .post(PERPLEXITY_ENDPOINT)
            .json(&body)
            .send()
            .await?
            .json::<Response>()
            .await
            .map_err(anyhow::Error::from)
    }
}
