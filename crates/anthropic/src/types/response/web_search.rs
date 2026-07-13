use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Web search response content returned by Claude when using the web_search tool
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct WebSearchResponse {
    pub content: WebSearchContent,
    pub tool_use_id: String,
}

/// Content of a web search response — either search results or an error.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(untagged)]
pub enum WebSearchContent {
    Results(Vec<SearchResult>),
    Error(WebSearchToolError),
}

/// A single search result from web search
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SearchResult {
    WebSearchResult {
        title: String,
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        encrypted_content: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        page_age: Option<String>,
    },
}

/// Error returned when web search fails
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct WebSearchToolError {
    pub r#type: String,
    pub error_code: String,
}

/// This is the expected shape of the streamed json following a `server_tool_use` in content_block_start event
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct WebSearchToolCall {
    pub query: String,
}
