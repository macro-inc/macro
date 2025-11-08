use crate::{MatchType, SearchOn, SearchResponseItem};
use item_filters::EmailFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A email message match for a given thread id
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchResult {
    /// The email message id.
    pub message_id: String,
    pub subject: Option<String>,
    pub sender: String,
    pub recipients: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub labels: Vec<String>,
    /// The array of content matches for the email message
    pub content: Vec<String>,
    /// When the search email message was last updated
    pub updated_at: i64,
    /// When the email message was sent
    pub sent_at: Option<i64>,
}

/// A single response item, part of the EmailSearchResponse object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchResponseItem {
    /// Standardized fields that all item types will share.
    /// These field names are being aligned across all item types
    /// for consistency in our data model.
    pub id: String,
    /// email threads don't have names, but keeping this here for consistency with other search items
    pub name: Option<String>,
    pub owner_id: String,

    /// The id of the email thread
    pub thread_id: String,
    /// The id of the owner of the email thread
    pub user_id: String,
    /// The search results for the document
    /// This may be empty if the search result match was on the email subject only
    pub email_message_search_results: Vec<EmailSearchResult>,
}

/// EmailSearchResponseItem object with email metadata we fetch from email service. we don't store these
/// timestamps in opensearch as they would require us to update each email message record for the thread
/// every time the thread updates (specifically for updated_at and viewed_at)
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchResponseItemWithMetadata {
    pub created_at: i64,
    pub updated_at: i64,
    pub viewed_at: Option<i64>,
    #[serde(flatten)]
    pub extra: EmailSearchResponseItem,
}

/// Metadata associated with Email Search
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchMetadata {
    /// The id of the email thread
    pub thread_id: String,
    /// The id of the owner of the email thread
    pub user_id: String,
}

impl From<SearchResponseItem<EmailSearchResult, EmailSearchMetadata>> for EmailSearchResponseItem {
    fn from(response: SearchResponseItem<EmailSearchResult, EmailSearchMetadata>) -> Self {
        EmailSearchResponseItem {
            id: response.metadata.thread_id.clone(),
            owner_id: response.metadata.user_id.clone(),
            name: None,
            thread_id: response.metadata.thread_id.clone(),
            user_id: response.metadata.user_id.clone(),
            email_message_search_results: response.results,
        }
    }
}

/// The document search response object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchResponse {
    /// List containing results from email threads
    pub results: Vec<EmailSearchResponseItemWithMetadata>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, JsonSchema)]
pub struct EmailSearchRequest {
    /// The query to search for
    pub query: Option<String>,
    /// Multiple terms to search over
    pub terms: Option<Vec<String>>,
    /// The match type to use when searching
    pub match_type: MatchType,
    /// Search filters for email
    #[serde(flatten)]
    pub filters: Option<EmailFilters>,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,
    /// If true, returns only 1 result per entity. False by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleEmailSearchResponseBaseItem<T> {
    /// The thread id
    pub thread_id: String,
    /// The message id
    pub message_id: String,
    /// The sender
    pub sender: String,
    /// The recipients
    pub recipients: Vec<String>,
    /// The cc
    pub cc: Vec<String>,
    /// The bcc
    pub bcc: Vec<String>,
    /// The labels
    pub labels: Vec<String>,
    /// The link id
    pub link_id: String,
    /// The user id
    pub user_id: String,
    #[schema(inline)]
    /// The time the email was last updated
    pub updated_at: T,
    #[schema(inline)]
    /// The time the email was sent
    pub sent_at: Option<T>,
    /// The subject
    pub subject: Option<String>,
    /// The opensearch matches on the email
    pub content: Option<Vec<String>>,
}

pub type SimpleEmailSearchResponseItem = SimpleEmailSearchResponseBaseItem<crate::TimestampSeconds>;

impl From<opensearch_client::search::emails::EmailSearchResponse>
    for SimpleEmailSearchResponseItem
{
    fn from(response: opensearch_client::search::emails::EmailSearchResponse) -> Self {
        Self {
            thread_id: response.thread_id,
            message_id: response.message_id,
            sender: response.sender,
            recipients: response.recipients,
            cc: response.cc,
            bcc: response.bcc,
            labels: response.labels,
            link_id: response.link_id,
            user_id: response.user_id,
            updated_at: response.updated_at.into(),
            sent_at: response.sent_at.map(|t| t.into()),
            subject: response.subject,
            content: response.content,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleEmailSearchResponse {
    /// List containing results from emails.
    /// Each item in the list is for a specific message in an email thread.
    pub results: Vec<SimpleEmailSearchResponseItem>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MatchType;

    #[test]
    fn test_email_search_request_json_serialization() {
        let request = EmailSearchRequest {
            query: Some("test query".to_string()),
            terms: Some(vec!["term1".to_string(), "term2".to_string()]),
            match_type: MatchType::Exact,
            filters: Some(EmailFilters {
                senders: vec!["sender@example.com".to_string()],
                cc: vec!["cc@example.com".to_string()],
                bcc: vec!["bcc@example.com".to_string()],
                recipients: vec![],
            }),
            search_on: SearchOn::Content,
            collapse: None,
        };

        let json = serde_json::to_string(&request).expect("Failed to serialize to JSON");
        let expected = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","senders":["sender@example.com"],"cc":["cc@example.com"],"bcc":["bcc@example.com"],"search_on":"content"}"#;

        assert_eq!(json, expected);
    }

    #[test]
    fn test_email_search_request_json_deserialization() {
        let json = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","senders":["sender@example.com"],"cc":["cc@example.com"],"bcc":["bcc@example.com"]}"#;

        let request: EmailSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize from JSON");

        assert_eq!(request.query, Some("test query".to_string()));
        assert_eq!(
            request.terms,
            Some(vec!["term1".to_string(), "term2".to_string()])
        );
        assert_eq!(request.match_type, MatchType::Exact);
        assert_eq!(
            request.filters.as_ref().unwrap().senders,
            vec!["sender@example.com".to_string()]
        );
        assert_eq!(
            request.filters.as_ref().unwrap().cc,
            vec!["cc@example.com".to_string()]
        );
        assert_eq!(
            request.filters.as_ref().unwrap().bcc,
            vec!["bcc@example.com".to_string()]
        );
    }

    #[test]
    fn test_email_search_request_minimal_json() {
        let json = r#"{"match_type":"partial"}"#;

        let request: EmailSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize minimal JSON");

        assert_eq!(request.query, None);
        assert_eq!(request.terms, None);
        assert_eq!(request.match_type, MatchType::Partial);
        // With #[serde(flatten)], filters will be Some(EmailFilters::default()) even when no filter fields are present
        assert_eq!(request.filters, Some(EmailFilters::default()));
    }

    #[test]
    fn test_email_search_request_all_match_types() {
        let test_cases = vec![
            ("exact", MatchType::Exact),
            ("partial", MatchType::Partial),
            ("query", MatchType::Query),
        ];

        for (json_value, expected_match_type) in test_cases {
            let json = format!(r#"{{"match_type":"{}"}}"#, json_value);
            let request: EmailSearchRequest = serde_json::from_str(&json)
                .unwrap_or_else(|_| panic!("Failed to deserialize match_type: {}", json_value));

            assert_eq!(request.match_type, expected_match_type);
        }
    }

    #[test]
    fn test_email_search_request_round_trip() {
        let original = EmailSearchRequest {
            query: Some("search term".to_string()),
            terms: None,
            match_type: MatchType::Query,
            filters: Some(EmailFilters {
                senders: vec![
                    "user1@example.com".to_string(),
                    "user2@example.com".to_string(),
                ],
                cc: vec![],
                bcc: vec!["secret@example.com".to_string()],
                recipients: vec![],
            }),
            search_on: SearchOn::Content,
            collapse: None,
        };

        let json = serde_json::to_string(&original).expect("Failed to serialize");
        let deserialized: EmailSearchRequest =
            serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(original.query, deserialized.query);
        assert_eq!(original.terms, deserialized.terms);
        assert_eq!(original.match_type, deserialized.match_type);
        assert_eq!(original.filters, deserialized.filters);
    }

    #[test]
    fn test_email_search_request_empty_arrays() {
        let json =
            r#"{"query":"test","terms":[],"match_type":"exact","senders":[],"cc":[],"bcc":[]}"#;

        let request: EmailSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize empty arrays");

        assert_eq!(request.query, Some("test".to_string()));
        assert_eq!(request.terms, Some(vec![]));
        assert_eq!(request.match_type, MatchType::Exact);
        assert!(request.filters.as_ref().unwrap().senders.is_empty());
        assert!(request.filters.as_ref().unwrap().bcc.is_empty());
        assert!(request.filters.as_ref().unwrap().cc.is_empty());
    }

    #[test]
    fn test_email_search_request_invalid_match_type() {
        let json = r#"{"match_type":"invalid"}"#;

        let result = serde_json::from_str::<EmailSearchRequest>(json);
        assert!(
            result.is_err(),
            "Should fail to deserialize invalid match_type"
        );
    }

    #[test]
    fn test_email_search_request_missing_required_field() {
        let json = r#"{"query":"test"}"#;

        let result = serde_json::from_str::<EmailSearchRequest>(json);
        assert!(
            result.is_err(),
            "Should fail to deserialize without required match_type field"
        );
    }

    #[test]
    fn test_email_search_request_filters_only() {
        let json = r#"{"match_type":"exact","senders":["test@example.com"]}"#;

        let request: EmailSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize filters only");

        assert_eq!(request.query, None);
        assert_eq!(request.terms, None);
        assert_eq!(request.match_type, MatchType::Exact);
        assert_eq!(
            request.filters.as_ref().unwrap().senders,
            vec!["test@example.com".to_string()]
        );
        assert!(request.filters.as_ref().unwrap().cc.is_empty());
        assert!(request.filters.as_ref().unwrap().bcc.is_empty());
    }
}
