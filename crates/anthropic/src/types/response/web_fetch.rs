use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Web fetch tool response content returned by Claude when using the web_fetch tool
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct WebFetchResponse {
    pub tool_use_id: String,
    pub content: WebFetchContent,
}

/// Content of a web fetch response - either a successful result or an error
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WebFetchContent {
    WebFetchResult(WebFetchResult),
    #[serde(rename = "web_fetch_tool_result_error")]
    WebFetchToolError(WebFetchToolError),
}

/// Successful web fetch result containing the fetched content
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct WebFetchResult {
    /// The URL that was fetched
    pub url: String,
    /// The fetched document content
    pub content: WebFetchDocument,
    /// Timestamp when the content was retrieved
    pub retrieved_at: String,
}

/// Document content from a web fetch
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct WebFetchDocument {
    /// The source content (text or base64)
    pub source: WebFetchSource,
    /// Optional title of the document
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Optional citations configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub citations: Option<CitationsConfig>,
}

/// Source content of a fetched document
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WebFetchSource {
    /// Plain text content
    Text { media_type: String, data: String },
    /// Base64-encoded content (e.g., PDF)
    Base64 { media_type: String, data: String },
}

/// Citations configuration for web fetch
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct CitationsConfig {
    pub enabled: bool,
}

/// Error returned when web fetch fails
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct WebFetchToolError {
    pub error_code: WebFetchErrorCode,
}

/// Possible error codes for web fetch failures
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WebFetchErrorCode {
    /// Invalid URL format
    InvalidInput,
    /// URL exceeds maximum length (250 characters)
    UrlTooLong,
    /// URL blocked by domain filtering rules and model restrictions
    UrlNotAllowed,
    /// Failed to fetch content (HTTP error)
    UrlNotAccessible,
    /// Rate limit exceeded
    TooManyRequests,
    /// Content type not supported (only text and PDF)
    UnsupportedContentType,
    /// Maximum web fetch tool uses exceeded
    MaxUsesExceeded,
    /// An internal error occurred
    Unavailable,
}

/// The expected shape of the streamed JSON following a `server_tool_use` in content_block_start event
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct WebFetchToolCall {
    pub url: String,
}
