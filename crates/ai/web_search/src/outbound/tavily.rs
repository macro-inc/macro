//! Tavily (<https://docs.tavily.com>) search and extract adapter.
//!
//! Tavily keeps no query data by default (zero data retention). Requests use
//! basic depth: one credit per search, one per five extracted URLs.

use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use macro_env_var::maybe_env_var;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::domain::models::{
    Billed, FetchedPage, PageRequest, ProviderError, SearchQuery, WebSearchResult, WebSearchTopic,
};
use crate::domain::ports::SearchProvider;

#[cfg(test)]
mod test;

maybe_env_var! {
    /// Tavily API key. Without it every web search and fetch fails with a
    /// "not configured" error. Never logged or sent to clients.
    pub struct TavilyApiKey;
}

const API_BASE: &str = "https://api.tavily.com";
const KEY_NAME: &str = "TAVILY_API_KEY";
/// Extract's own server-side timeout is 10 s at basic depth; leave headroom.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Tavily search and extract over HTTPS.
#[derive(Clone)]
pub struct TavilyClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Option<String>,
}

impl TavilyClient {
    /// A client for `api_key`, or one whose calls fail as not configured
    /// when the key is unset or blank.
    pub fn new(api_key: &TavilyApiKey) -> Self {
        Self::with_base_url(api_key, API_BASE)
    }

    /// Read `TAVILY_API_KEY`, logging an error at startup when it is missing.
    pub fn from_env() -> Self {
        let api_key = TavilyApiKey::new().unwrap_or(TavilyApiKey::Unset);
        let client = Self::new(&api_key);
        if client.api_key.is_none() {
            tracing::error!("{KEY_NAME} is not set; WebSearch and WebFetch will fail");
        }
        client
    }

    /// A client against another base URL, for tests.
    pub fn with_base_url(api_key: &TavilyApiKey, base_url: &str) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("static reqwest configuration is valid"),
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key: api_key
                .value()
                .map(str::trim)
                .filter(|key| !key.is_empty())
                .map(str::to_owned),
        }
    }

    async fn post<Request: Serialize, Response: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &Request,
    ) -> Result<Response, ProviderError> {
        let api_key = self
            .api_key
            .as_deref()
            .ok_or(ProviderError::NotConfigured(KEY_NAME))?;
        let response = self
            .http
            .post(format!("{}{path}", self.base_url))
            .bearer_auth(api_key)
            .json(body)
            .send()
            .await
            .context("tavily request failed")?;
        let status = response.status();
        // 432/433 are Tavily's plan and pay-as-you-go limits.
        if status == StatusCode::TOO_MANY_REQUESTS || matches!(status.as_u16(), 432 | 433) {
            return Err(ProviderError::Throttled(status.as_u16()));
        }
        if !status.is_success() {
            return Err(ProviderError::Failed(anyhow::anyhow!(
                "tavily {path} returned HTTP {status}"
            )));
        }
        Ok(response
            .json()
            .await
            .with_context(|| format!("tavily {path} returned an unexpected body"))?)
    }
}

#[async_trait]
impl SearchProvider for TavilyClient {
    fn pricing_model(&self) -> &'static str {
        "tavily"
    }

    async fn search(
        &self,
        query: &SearchQuery,
    ) -> Result<Billed<Vec<WebSearchResult>>, ProviderError> {
        let response: SearchResponse = self.post("/search", &SearchRequest::from(query)).await?;
        Ok(Billed {
            credits: response.usage.map(|usage| usage.credits),
            value: response
                .results
                .into_iter()
                .map(|result| WebSearchResult {
                    title: result.title,
                    url: result.url,
                    snippet: result.content,
                    published_at: result.published_date,
                    content: result.raw_content,
                })
                .collect(),
        })
    }

    async fn fetch(&self, request: &PageRequest) -> Result<Billed<FetchedPage>, ProviderError> {
        let response: ExtractResponse = self
            .post(
                "/extract",
                &ExtractRequest {
                    urls: [request.url.as_str()],
                    extract_depth: "basic",
                    format: "markdown",
                    include_usage: true,
                },
            )
            .await?;
        let credits = response.usage.map(|usage| usage.credits);
        match response.results.into_iter().next() {
            Some(page) => Ok(Billed {
                credits,
                value: FetchedPage {
                    url: page.url,
                    title: None,
                    content: page.raw_content,
                },
            }),
            None => Err(ProviderError::PageUnavailable(
                response
                    .failed_results
                    .into_iter()
                    .next()
                    .map(|failure| failure.error)
                    .unwrap_or_else(|| "no content was returned".to_owned()),
            )),
        }
    }
}

#[derive(Debug, Serialize, PartialEq)]
struct SearchRequest<'a> {
    query: &'a str,
    topic: Topic,
    search_depth: &'static str,
    max_results: u8,
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    include_domains: &'a [String],
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    exclude_domains: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    start_date: Option<String>,
    include_published_date: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    include_raw_content: Option<&'static str>,
    include_answer: bool,
    include_images: bool,
    include_usage: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Topic {
    General,
    News,
}

impl<'a> From<&'a SearchQuery> for SearchRequest<'a> {
    fn from(query: &'a SearchQuery) -> Self {
        Self {
            query: &query.query,
            topic: match query.topic {
                WebSearchTopic::General => Topic::General,
                WebSearchTopic::News => Topic::News,
            },
            search_depth: "basic",
            max_results: query.max_results,
            include_domains: &query.domains,
            exclude_domains: &query.exclude_domains,
            start_date: query.since.map(|date| date.format("%Y-%m-%d").to_string()),
            include_published_date: true,
            include_raw_content: query.include_content.then_some("markdown"),
            include_answer: false,
            include_images: false,
            include_usage: true,
        }
    }
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    results: Vec<SearchResult>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct SearchResult {
    title: String,
    url: String,
    content: String,
    #[serde(default)]
    raw_content: Option<String>,
    #[serde(default)]
    published_date: Option<String>,
}

#[derive(Debug, Serialize)]
struct ExtractRequest<'a> {
    urls: [&'a str; 1],
    extract_depth: &'static str,
    format: &'static str,
    include_usage: bool,
}

#[derive(Debug, Deserialize)]
struct ExtractResponse {
    results: Vec<ExtractResult>,
    #[serde(default)]
    failed_results: Vec<ExtractFailure>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct ExtractResult {
    url: String,
    raw_content: String,
}

#[derive(Debug, Deserialize)]
struct ExtractFailure {
    error: String,
}

#[derive(Debug, Deserialize)]
struct Usage {
    credits: u64,
}
