//! Web search and page fetch requests, results, and failures.

use chrono::NaiveDate;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Longest accepted query, in characters.
pub const MAX_QUERY_CHARS: usize = 400;
/// Most results one search may return.
pub const MAX_RESULTS: u8 = 20;
/// Results returned when the caller does not ask for a count.
pub const DEFAULT_RESULTS: u8 = 5;
/// Most domains a search may be restricted to.
pub const MAX_DOMAINS: usize = 300;
/// Most domains a search may exclude.
pub const MAX_EXCLUDED_DOMAINS: usize = 150;
/// Page text kept per search result when `includeContent` is set.
pub const SEARCH_CONTENT_CHARS: usize = 8_000;
/// Page text a fetch returns when the caller does not ask for a length.
pub const DEFAULT_FETCH_CHARS: u32 = 20_000;
/// Most page text one fetch may return.
pub const MAX_FETCH_CHARS: u32 = 100_000;

/// The kind of results a search favours.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum WebSearchTopic {
    /// Any page on the web.
    #[default]
    General,
    /// Recent news articles, with publication dates.
    News,
}

/// Search the public web.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "WebSearch",
    description = "Search the public web. Returns up to `maxResults` pages, each with its title, URL, a query-relevant snippet and, for news, its publication date. Snippets are often enough to answer; call WebFetch on a result's URL when you need the full page. Cite the URLs you use."
)]
pub struct WebSearch {
    /// What to search for, in natural language or keywords (at most 400 characters).
    pub query: String,
    /// Only return pages from these domains, e.g. `["docs.rs", "github.com"]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domains: Option<Vec<String>>,
    /// Never return pages from these domains.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude_domains: Option<Vec<String>>,
    /// Only return pages published on or after this date (`YYYY-MM-DD`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<NaiveDate>,
    /// `news` for recent articles with publication dates; `general` (the default) otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topic: Option<WebSearchTopic>,
    /// How many results to return, 1 to 20 (default 5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_results: Option<u8>,
    /// Also return each page's text as Markdown (up to 8,000 characters per result).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_content: Option<bool>,
}

/// One page a search found.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResult {
    /// The page title.
    pub title: String,
    /// The page URL; cite it when you use the result.
    pub url: String,
    /// The part of the page most relevant to the query.
    pub snippet: String,
    /// When the page was published, as the search provider reports it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    /// The page text as Markdown, when `includeContent` was set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

/// The pages a search found, best match first.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResponse {
    /// Results, best match first. Empty when nothing matched.
    pub results: Vec<WebSearchResult>,
}

/// Read one public web page.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "WebFetch",
    description = "Read the text of one public web page as Markdown. Use it on a URL the user gave you or one WebSearch returned, when the snippet is not enough. Pages that need a login, or that render only with JavaScript, may fail. Cite the URL you read."
)]
pub struct WebFetch {
    /// The `http` or `https` URL of the page.
    pub url: String,
    /// Most characters of page text to return, 1 to 100,000 (default 20,000).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_chars: Option<u32>,
}

/// The text of a fetched page.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchResponse {
    /// The URL that was read.
    pub url: String,
    /// The page title, when the provider reports one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The page text as Markdown, cut to `maxChars`.
    pub content: String,
    /// Whether `content` was cut to `maxChars`.
    pub truncated: bool,
}

/// A validated search, as a provider receives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchQuery {
    /// What to search for.
    pub query: String,
    /// Domains results must come from; empty means any.
    pub domains: Vec<String>,
    /// Domains results must not come from.
    pub exclude_domains: Vec<String>,
    /// Earliest publication date.
    pub since: Option<NaiveDate>,
    /// The kind of results to favour.
    pub topic: WebSearchTopic,
    /// How many results to return.
    pub max_results: u8,
    /// Whether to return each page's text.
    pub include_content: bool,
}

/// A validated fetch, as a provider receives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageRequest {
    /// The page to read.
    pub url: url::Url,
}

/// A page a provider read, before it is cut to the caller's length.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchedPage {
    /// The URL that was read.
    pub url: String,
    /// The page title, when known.
    pub title: Option<String>,
    /// The page text as Markdown.
    pub content: String,
}

/// A provider's answer and the credits it billed for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Billed<T> {
    /// The answer.
    pub value: T,
    /// Credits the provider reported billing, or `None` when it reported none.
    pub credits: Option<u64>,
}

/// Why a provider call failed.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    /// The provider has no credentials in this deployment.
    #[error("web search is not configured: {0} is not set")]
    NotConfigured(&'static str),
    /// The provider is throttling us or our plan's credits are exhausted.
    #[error("web search provider is rate limited (HTTP {0})")]
    Throttled(u16),
    /// The provider could not read the requested page.
    #[error("the page could not be read: {0}")]
    PageUnavailable(String),
    /// Any other provider failure.
    #[error(transparent)]
    Failed(#[from] anyhow::Error),
}

/// Why a web search or fetch was refused or failed.
#[derive(Debug, thiserror::Error)]
pub enum WebSearchError {
    /// The request is malformed or out of bounds.
    #[error("{0}")]
    InvalidRequest(String),
    /// Shared AI admission refused the request.
    #[error(transparent)]
    Admission(#[from] ai_billing::AiAdmissionError),
    /// No provider credentials are configured.
    #[error("{0}")]
    NotConfigured(String),
    /// The provider is throttling requests.
    #[error("Web search is busy; try again shortly")]
    Throttled,
    /// The page could not be read.
    #[error("{0}")]
    PageUnavailable(String),
    /// The provider failed.
    #[error("Web search failed; try again")]
    Provider(#[source] anyhow::Error),
}

impl WebSearchError {
    /// Stable machine-readable failure code.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "invalid_request",
            Self::Admission(error) => error.code(),
            Self::NotConfigured(_) => "web_search_not_configured",
            Self::Throttled => "web_search_throttled",
            Self::PageUnavailable(_) => "fetch_failed",
            Self::Provider(_) => "web_search_failed",
        }
    }
}

impl From<ProviderError> for WebSearchError {
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::NotConfigured(_) => Self::NotConfigured(error.to_string()),
            ProviderError::Throttled(_) => Self::Throttled,
            ProviderError::PageUnavailable(reason) => {
                Self::PageUnavailable(format!("The page could not be read: {reason}"))
            }
            ProviderError::Failed(error) => Self::Provider(error),
        }
    }
}
