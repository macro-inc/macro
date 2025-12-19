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

/// Server response notification for web search tool use
/// This appears in the response stream before the actual search results
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct WebSearchNotification {
    /// Unique identifier for this tool use
    pub id: String,
    /// The name of the tool (should be "web_search")
    pub name: String,
    /// Input parameters to the web search tool
    pub input: WebSearchInput,
}

/// Input parameters for web search
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct WebSearchInput {
    /// The search query
    pub query: String,
    /// Optional list of domains to include results from
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_domains: Option<Vec<String>>,
    /// Optional list of domains to exclude from results
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_domains: Option<Vec<String>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_web_search_response_serialization() {
        let response = WebSearchResponse {
            content: vec![
                SearchResult::WebSearchResult {
                    title: "The Rust Programming Language".to_string(),
                    url: "https://www.rust-lang.org/".to_string(),
                },
                SearchResult::WebSearchResult {
                    title: "Rust Documentation".to_string(),
                    url: "https://doc.rust-lang.org/".to_string(),
                },
            ],
        };

        let serialized = serde_json::to_value(&response).expect("serialization should succeed");
        let expected = json!({
            "content": [
                {
                    "type": "Result",
                    "title": "The Rust Programming Language",
                    "url": "https://www.rust-lang.org/"
                },
                {
                    "type": "Result",
                    "title": "Rust Documentation",
                    "url": "https://doc.rust-lang.org/"
                }
            ]
        });

        assert_eq!(serialized, expected);
    }

    #[test]
    fn test_web_search_response_deserialization() {
        let json_data = json!({
            "content": [
                {
                    "type": "Result",
                    "title": "Async Programming in Rust",
                    "url": "https://rust-lang.github.io/async-book/"
                }
            ]
        });

        let response: WebSearchResponse =
            serde_json::from_value(json_data).expect("deserialization should succeed");

        assert_eq!(response.content.len(), 1);
        match &response.content[0] {
            SearchResult::WebSearchResult { title, url } => {
                assert_eq!(title, "Async Programming in Rust");
                assert_eq!(url, "https://rust-lang.github.io/async-book/");
            }
        }
    }

    #[test]
    fn test_web_search_notification() {
        let notification = WebSearchNotification {
            id: "tool_123".to_string(),
            name: "web_search".to_string(),
            input: WebSearchInput {
                query: "claude api documentation".to_string(),
                allowed_domains: Some(vec!["anthropic.com".to_string()]),
                blocked_domains: None,
            },
        };

        let serialized = serde_json::to_value(&notification).expect("serialization should succeed");
        let expected = json!({
            "id": "tool_123",
            "name": "web_search",
            "input": {
                "query": "claude api documentation",
                "allowed_domains": ["anthropic.com"]
            }
        });

        assert_eq!(serialized, expected);
    }

    #[test]
    fn test_web_search_input_with_blocked_domains() {
        let input = WebSearchInput {
            query: "programming tutorials".to_string(),
            allowed_domains: None,
            blocked_domains: Some(vec!["spam.com".to_string(), "ads.com".to_string()]),
        };

        let serialized = serde_json::to_value(&input).expect("serialization should succeed");
        let expected = json!({
            "query": "programming tutorials",
            "blocked_domains": ["spam.com", "ads.com"]
        });

        assert_eq!(serialized, expected);
    }
}
