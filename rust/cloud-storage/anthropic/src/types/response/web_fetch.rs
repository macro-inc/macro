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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_web_fetch_result() {
        let json = r#"{
            "tool_use_id": "srvtoolu_01234567890abcdef",
            "content": {
                "type": "web_fetch_result",
                "url": "https://example.com/article",
                "content": {
                    "source": {
                        "type": "text",
                        "media_type": "text/plain",
                        "data": "Full text content of the article..."
                    },
                    "title": "Article Title",
                    "citations": {"enabled": true}
                },
                "retrieved_at": "2025-08-25T10:30:00Z"
            }
        }"#;

        let result: WebFetchResponse = serde_json::from_str(json).expect("deserialize");
        assert_eq!(result.tool_use_id, "srvtoolu_01234567890abcdef");
        if let WebFetchContent::WebFetchResult(r) = result.content {
            assert_eq!(r.url, "https://example.com/article");
            assert_eq!(r.content.title, Some("Article Title".to_string()));
        } else {
            panic!("Expected WebFetchResult");
        }
    }

    #[test]
    fn test_deserialize_web_fetch_pdf() {
        let json = r#"{
            "tool_use_id": "srvtoolu_02",
            "content": {
                "type": "web_fetch_result",
                "url": "https://example.com/paper.pdf",
                "content": {
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmo..."
                    },
                    "citations": {"enabled": true}
                },
                "retrieved_at": "2025-08-25T10:30:02Z"
            }
        }"#;

        let result: WebFetchResponse = serde_json::from_str(json).expect("deserialize");
        if let WebFetchContent::WebFetchResult(r) = result.content {
            if let WebFetchSource::Base64 { media_type, .. } = r.content.source {
                assert_eq!(media_type, "application/pdf");
            } else {
                panic!("Expected Base64 source");
            }
        } else {
            panic!("Expected WebFetchResult");
        }
    }

    #[test]
    fn test_deserialize_web_fetch_error() {
        let json = r#"{
            "tool_use_id": "srvtoolu_a93jad",
            "content": {
                "type": "web_fetch_tool_result_error",
                "error_code": "url_not_accessible"
            }
        }"#;

        let result: WebFetchResponse = serde_json::from_str(json).expect("deserialize");
        if let WebFetchContent::WebFetchToolError(e) = result.content {
            assert_eq!(e.error_code, WebFetchErrorCode::UrlNotAccessible);
        } else {
            panic!("Expected WebFetchToolError");
        }
    }

    #[test]
    fn test_deserialize_tool_call() {
        let json = r#"{"url": "https://example.com/article"}"#;
        let call: WebFetchToolCall = serde_json::from_str(json).expect("deserialize");
        assert_eq!(call.url, "https://example.com/article");
    }
}
