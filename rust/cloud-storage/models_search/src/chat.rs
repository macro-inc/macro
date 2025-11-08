use item_filters::ChatFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{MatchType, SearchOn, SearchResponseItem};

/// A chat match for a given message id
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatMessageSearchResult {
    /// The chat message id for the chat
    pub chat_message_id: String,
    /// The role of the chat message
    pub role: String,
    /// The array of content matches for the message
    pub content: Vec<String>,
    /// When the search chat was last updated
    pub updated_at: i64,
    /// The title of the chat
    pub title: String,
}

/// A single response item, part of the ChatSearchResponse object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatSearchResponseItem {
    /// Standardized fields that all item types will share.
    /// These field names are being aligned across all item types
    /// for consistency in our data model.
    pub id: String,
    pub name: String,
    pub owner_id: String,

    /// The id of the chat
    pub chat_id: String,
    /// The id of the creator of the chat
    pub user_id: String,
    /// The search results for the chat
    /// This may be empty if the search result match was on the chat title only
    pub chat_search_results: Vec<ChatMessageSearchResult>,
}

/// ChatSearchResponse object with channel metadata we fetch from macrodb. we don't store these
/// timestamps in opensearch as they would require us to update each chat message record for the chat
/// every time the chat updates (specifically for updated_at and viewed_at)
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatSearchResponseItemWithMetadata {
    pub created_at: i64,
    pub updated_at: i64,
    pub viewed_at: Option<i64>,
    pub project_id: Option<String>,
    #[serde(flatten)]
    pub extra: ChatSearchResponseItem,
}

/// The chat search response object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatSearchResponse {
    /// List containing results from chats
    pub results: Vec<ChatSearchResponseItemWithMetadata>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct ChatSearchRequest {
    /// The query to search for
    pub query: Option<String>,
    /// Multiple terms to search over
    pub terms: Option<Vec<String>>,
    /// The match type to use when searching
    pub match_type: MatchType,
    /// Search filters for chat
    #[serde(flatten)]
    pub filters: Option<ChatFilters>,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,
    /// If true, returns only 1 result per entity. False by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse: Option<bool>,
}

/// Metadata associated with Chat Search, to be used with SearchResponseItem
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatSearchMetadata {
    /// The id of the chat
    pub chat_id: String,
    /// The id of the creator of the chat
    pub user_id: String,
    /// The name of the chat
    pub title: String,
}

impl From<SearchResponseItem<ChatMessageSearchResult, ChatSearchMetadata>>
    for ChatSearchResponseItem
{
    fn from(response: SearchResponseItem<ChatMessageSearchResult, ChatSearchMetadata>) -> Self {
        ChatSearchResponseItem {
            id: response.metadata.chat_id.clone(),
            name: response.metadata.title.clone(),
            owner_id: response.metadata.user_id.clone(),
            chat_id: response.metadata.chat_id.clone(),
            user_id: response.metadata.user_id.clone(),
            chat_search_results: response.results,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleChatSearchResponseBaseItem<T> {
    /// The chat id
    pub chat_id: String,
    /// The chat message id
    pub chat_message_id: String,
    /// The user id
    pub user_id: String,
    /// The role
    pub role: String,
    #[schema(inline)]
    /// The time the chat was last updated
    pub updated_at: T,
    /// The title
    pub title: String,
    /// The opensearch matches on the chat
    pub content: Option<Vec<String>>,
}

pub type SimpleChatSearchResponseItem = SimpleChatSearchResponseBaseItem<crate::TimestampSeconds>;

impl From<opensearch_client::search::chats::ChatSearchResponse> for SimpleChatSearchResponseItem {
    fn from(response: opensearch_client::search::chats::ChatSearchResponse) -> Self {
        Self {
            chat_id: response.chat_id,
            chat_message_id: response.chat_message_id,
            user_id: response.user_id,
            role: response.role,
            updated_at: response.updated_at.into(),
            title: response.title,
            content: response.content,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleChatSearchResponse {
    /// List containing results from chats.
    /// Each item in the list is for a specific message in a chat.
    pub results: Vec<SimpleChatSearchResponseItem>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MatchType;

    #[test]
    fn test_chat_search_request_json_serialization() {
        let request = ChatSearchRequest {
            query: Some("test query".to_string()),
            terms: Some(vec!["term1".to_string(), "term2".to_string()]),
            match_type: MatchType::Exact,
            filters: Some(ChatFilters {
                role: vec!["user".to_string(), "system".to_string()],
                chat_ids: vec![],
                project_ids: vec![],
                owners: vec![],
            }),
            search_on: SearchOn::Content,
            collapse: None,
        };

        let json = serde_json::to_string(&request).expect("Failed to serialize to JSON");
        let expected = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","role":["user","system"],"search_on":"content"}"#;

        assert_eq!(json, expected);
    }

    #[test]
    fn test_chat_search_request_json_deserialization() {
        let json = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","role":["user","system"]}"#;

        let request: ChatSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize from JSON");

        assert_eq!(request.query, Some("test query".to_string()));
        assert_eq!(
            request.terms,
            Some(vec!["term1".to_string(), "term2".to_string()])
        );
        assert_eq!(request.match_type, MatchType::Exact);
        assert_eq!(
            request.filters.as_ref().unwrap().role,
            vec!["user".to_string(), "system".to_string()]
        );
    }

    #[test]
    fn test_chat_search_request_minimal_json() {
        let json = r#"{"match_type":"partial"}"#;

        let request: ChatSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize minimal JSON");

        assert_eq!(request.query, None);
        assert_eq!(request.terms, None);
        assert_eq!(request.match_type, MatchType::Partial);
        // With #[serde(flatten)], filters will be Some(ChatFilters::default()) even when no filter fields are present
        assert_eq!(request.filters, Some(ChatFilters::default()));
    }

    #[test]
    fn test_chat_search_request_all_match_types() {
        let test_cases = vec![
            ("exact", MatchType::Exact),
            ("partial", MatchType::Partial),
            ("query", MatchType::Query),
        ];

        for (json_value, expected_match_type) in test_cases {
            let json = format!(r#"{{"match_type":"{}"}}"#, json_value);
            let request: ChatSearchRequest = serde_json::from_str(&json)
                .unwrap_or_else(|_| panic!("Failed to deserialize match_type: {}", json_value));

            assert_eq!(request.match_type, expected_match_type);
        }
    }

    #[test]
    fn test_chat_search_request_round_trip() {
        let original = ChatSearchRequest {
            query: Some("search term".to_string()),
            terms: None,
            match_type: MatchType::Query,
            filters: Some(ChatFilters {
                role: vec!["user".to_string()],
                chat_ids: vec![],
                project_ids: vec![],
                owners: vec![],
            }),
            search_on: SearchOn::Content,
            collapse: None,
        };

        let json = serde_json::to_string(&original).expect("Failed to serialize");
        let deserialized: ChatSearchRequest =
            serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(original.query, deserialized.query);
        assert_eq!(original.terms, deserialized.terms);
        assert_eq!(original.match_type, deserialized.match_type);
        assert_eq!(original.filters, deserialized.filters);
    }

    #[test]
    fn test_chat_search_request_empty_arrays() {
        let json = r#"{"query":"test","terms":[],"match_type":"exact","role":[]}"#;

        let request: ChatSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize empty arrays");

        assert_eq!(request.query, Some("test".to_string()));
        assert_eq!(request.terms, Some(vec![]));
        assert_eq!(request.match_type, MatchType::Exact);
        assert!(request.filters.as_ref().unwrap().role.is_empty());
    }

    #[test]
    fn test_chat_search_request_with_role_only() {
        let json = r#"{"match_type":"partial","role":["user","assistant","system"]}"#;

        let request: ChatSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize with role only");

        assert_eq!(request.query, None);
        assert_eq!(request.terms, None);
        assert_eq!(request.match_type, MatchType::Partial);
        assert_eq!(
            request.filters.as_ref().unwrap().role,
            vec![
                "user".to_string(),
                "assistant".to_string(),
                "system".to_string()
            ]
        );
    }

    #[test]
    fn test_chat_search_request_with_query_and_terms() {
        let json =
            r#"{"query":"main query","terms":["term1","term2","term3"],"match_type":"query"}"#;

        let request: ChatSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize with query and terms");

        assert_eq!(request.query, Some("main query".to_string()));
        assert_eq!(
            request.terms,
            Some(vec![
                "term1".to_string(),
                "term2".to_string(),
                "term3".to_string()
            ])
        );
        assert_eq!(request.match_type, MatchType::Query);
        assert_eq!(request.filters, Some(ChatFilters::default()));
    }

    #[test]
    fn test_chat_search_request_user_role_only() {
        let json = r#"{"match_type":"exact","role":["user"]}"#;

        let request: ChatSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize user role only");

        assert_eq!(request.query, None);
        assert_eq!(request.terms, None);
        assert_eq!(request.match_type, MatchType::Exact);
        assert_eq!(
            request.filters.as_ref().unwrap().role,
            vec!["user".to_string()]
        );
    }

    #[test]
    fn test_chat_search_request_invalid_match_type() {
        let json = r#"{"match_type":"invalid"}"#;

        let result = serde_json::from_str::<ChatSearchRequest>(json);
        assert!(
            result.is_err(),
            "Should fail to deserialize invalid match_type"
        );
    }

    #[test]
    fn test_chat_search_request_missing_required_field() {
        let json = r#"{"query":"test"}"#;

        let result = serde_json::from_str::<ChatSearchRequest>(json);
        assert!(
            result.is_err(),
            "Should fail to deserialize without required match_type field"
        );
    }

    #[test]
    fn test_chat_search_request_filters_only() {
        let json = r#"{"match_type":"exact","role":["user","assistant"]}"#;

        let request: ChatSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize filters only");

        assert_eq!(request.query, None);
        assert_eq!(request.terms, None);
        assert_eq!(request.match_type, MatchType::Exact);
        assert_eq!(
            request.filters.as_ref().unwrap().role,
            vec!["user".to_string(), "assistant".to_string()]
        );
    }

    #[test]
    fn test_search_response_item_to_chat_response_item_with_metadata() {
        let search_item = SearchResponseItem {
            results: vec![
                ChatMessageSearchResult {
                    chat_message_id: "msg_1".to_string(),
                    role: "user".to_string(),
                    content: vec!["hello".to_string()],
                    updated_at: 1234567890,
                    title: "Test".to_string(),
                },
                ChatMessageSearchResult {
                    chat_message_id: "msg_2".to_string(),
                    role: "assistant".to_string(),
                    content: vec!["world".to_string()],
                    updated_at: 1234567891,
                    title: "Test".to_string(),
                },
            ],
            metadata: ChatSearchMetadata {
                chat_id: "chat_123".to_string(),
                user_id: "user_456".to_string(),
                title: "hello".to_string(),
            },
        };

        let chat_response: ChatSearchResponseItem = search_item.into();

        assert_eq!(chat_response.chat_id, "chat_123");
        assert_eq!(chat_response.id, "chat_123");
        assert_eq!(chat_response.user_id, "user_456");
        assert_eq!(chat_response.owner_id, "user_456");
        assert_eq!(chat_response.name, "hello");
        assert_eq!(chat_response.chat_search_results.len(), 2);
        assert_eq!(
            chat_response.chat_search_results[0].chat_message_id,
            "msg_1"
        );
        assert_eq!(
            chat_response.chat_search_results[1].chat_message_id,
            "msg_2"
        );
    }

    #[test]
    fn test_serialization_equivalence() {
        // Create a ChatSearchResponseItem directly
        let direct_response = ChatSearchResponseItem {
            id: "chat_123".to_string(),
            name: "hello".to_string(),
            owner_id: "user_456".to_string(),
            chat_id: "chat_123".to_string(),
            user_id: "user_456".to_string(),
            chat_search_results: vec![ChatMessageSearchResult {
                chat_message_id: "msg_1".to_string(),
                role: "user".to_string(),
                content: vec!["test content".to_string()],
                updated_at: 1234567890,
                title: "Test Chat".to_string(),
            }],
        };

        // Create the same thing via SearchResponseItem conversion
        let search_item = SearchResponseItem {
            results: vec![ChatMessageSearchResult {
                chat_message_id: "msg_1".to_string(),
                role: "user".to_string(),
                content: vec!["test content".to_string()],
                updated_at: 1234567890,
                title: "Test Chat".to_string(),
            }],
            metadata: ChatSearchMetadata {
                chat_id: "chat_123".to_string(),
                user_id: "user_456".to_string(),
                title: "hello".to_string(),
            },
        };
        let converted_response: ChatSearchResponseItem = search_item.into();

        // Serialize both
        let direct_json = serde_json::to_string(&direct_response).unwrap();
        let converted_json = serde_json::to_string(&converted_response).unwrap();

        // They should be identical
        assert_eq!(direct_json, converted_json);

        // Also test that we can deserialize both back to the same thing
        let direct_deserialized: ChatSearchResponseItem =
            serde_json::from_str(&direct_json).unwrap();
        let converted_deserialized: ChatSearchResponseItem =
            serde_json::from_str(&converted_json).unwrap();

        assert_eq!(direct_deserialized.chat_id, converted_deserialized.chat_id);
        assert_eq!(direct_deserialized.id, converted_deserialized.id);
        assert_eq!(direct_deserialized.name, converted_deserialized.name);
        assert_eq!(direct_deserialized.user_id, converted_deserialized.user_id);
        assert_eq!(
            direct_deserialized.owner_id,
            converted_deserialized.owner_id
        );
        assert_eq!(
            direct_deserialized.chat_search_results.len(),
            converted_deserialized.chat_search_results.len()
        );
    }
}
