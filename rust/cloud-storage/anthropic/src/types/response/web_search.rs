use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Web search response content returned by Claude when using the web_search tool
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct WebSearchResponse {
    /// The search query that was executed
    /// Array of search results
    pub content: Vec<SearchResult>,
    pub tool_use_id: String,
}

/// A single search result from web search
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SearchResult {
    WebSearchResult { title: String, url: String },
}

/// This is the expected shape of the streamed json following a `server_tool_use` in content_block_start event
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct WebSearchToolCall {
    pub query: String,
}
