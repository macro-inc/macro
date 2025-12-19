use serde::{Deserialize, Serialize};

/// Web search response content returned by Claude when using the web_search tool
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct WebSearchResponse {
    /// The search query that was executed
    /// Array of search results
    pub content: Vec<SearchResult>,
}

/// A single search result from web search
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SearchResult {
    WebSearchResult { title: String, url: String },
}
