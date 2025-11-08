use item_filters::DocumentFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{MatchType, SearchOn, SearchResponseItem};

/// A document match for a given node
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DocumentSearchResult {
    /// The node id for the document.
    /// This is only useful for markdown at the moment
    pub node_id: String,
    /// The array of content matches for the document
    pub content: Vec<String>,
    /// The raw content of the document.
    /// This is only included for markdown files and will be the raw json node of the match
    pub raw_content: Option<String>,
    /// When the search document was last updated
    pub updated_at: i64,
}

/// A single response item, part of the DocumentSearchResponse object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DocumentSearchResponseItem {
    /// Standardized fields that all item types will share.
    /// These field names are being aligned across all item types
    /// for consistency in our data model.
    pub id: String,
    pub name: String,
    pub owner_id: String,

    /// The id of the document
    pub document_id: String,
    /// The name of the document
    pub document_name: String,
    /// The file type of the document
    pub file_type: String,
    /// The search results for the document
    /// This may be empty if the search result match was on the document name only
    pub document_search_results: Vec<DocumentSearchResult>,
}

/// DocumentSearchResponseItem object with document metadata we fetch from macrodb. we don't store these
/// timestamps in opensearch as they would require us to update document page record
/// every time the document updates (specifically for updated_at and viewed_at)
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DocumentSearchResponseItemWithMetadata {
    pub created_at: i64,
    pub updated_at: i64,
    pub viewed_at: Option<i64>,
    pub project_id: Option<String>,
    #[serde(flatten)]
    pub extra: DocumentSearchResponseItem,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct DocumentSearchMetadata {
    /// The document version id.
    pub document_id: String,
    /// The name of the document
    pub document_name: String,
    /// The id of the owner of the document
    pub owner_id: String,
    /// The file type of the document
    pub file_type: String,
}

impl From<SearchResponseItem<DocumentSearchResult, DocumentSearchMetadata>>
    for DocumentSearchResponseItem
{
    fn from(response: SearchResponseItem<DocumentSearchResult, DocumentSearchMetadata>) -> Self {
        DocumentSearchResponseItem {
            id: response.metadata.document_id.clone(),
            name: response.metadata.document_name.clone(),
            document_id: response.metadata.document_id.clone(),
            document_name: response.metadata.document_name,
            owner_id: response.metadata.owner_id,
            file_type: response.metadata.file_type,
            document_search_results: response.results,
        }
    }
}

/// The document search response object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DocumentSearchResponse {
    /// List containing results from documents
    pub results: Vec<DocumentSearchResponseItemWithMetadata>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleDocumentSearchResponseBaseItem<T> {
    /// The document id
    pub document_id: String,
    /// The document name
    pub document_name: String,
    /// The node id
    pub node_id: String,
    /// The owner id
    pub owner_id: String,
    /// The file type
    pub file_type: String,
    #[schema(inline)]
    /// The time the document was last updated
    pub updated_at: T,
    /// The opensearch matches on the document
    pub content: Option<Vec<String>>,
    /// The raw content of the document
    pub raw_content: Option<String>,
}

pub type SimpleDocumentSearchResponseItem =
    SimpleDocumentSearchResponseBaseItem<crate::TimestampSeconds>;

impl From<opensearch_client::search::documents::DocumentSearchResponse>
    for SimpleDocumentSearchResponseItem
{
    fn from(response: opensearch_client::search::documents::DocumentSearchResponse) -> Self {
        Self {
            document_id: response.document_id,
            document_name: response.document_name,
            node_id: response.node_id,
            owner_id: response.owner_id,
            file_type: response.file_type,
            updated_at: response.updated_at.into(),
            content: response.content,
            raw_content: response.raw_content,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleDocumentSearchResponse {
    /// List containing results from documents.
    /// Each item in the list is for a specific page/node of a document.
    pub results: Vec<SimpleDocumentSearchResponseItem>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, JsonSchema)]
pub struct DocumentSearchRequest {
    /// The query to search for
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    /// Multiple terms to search over
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terms: Option<Vec<String>>,
    /// The match type to use when searching
    pub match_type: MatchType,
    /// Search filters for documents
    #[serde(flatten)]
    pub filters: Option<DocumentFilters>,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,
    /// If true, returns only 1 result per entity. False by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse: Option<bool>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
pub struct MarkdownParseResult {
    pub node_id: String,
    pub content: String,
    pub raw_content: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MatchType;

    #[test]
    fn test_document_search_request_json_serialization() {
        let request = DocumentSearchRequest {
            query: Some("test query".to_string()),
            terms: Some(vec!["term1".to_string(), "term2".to_string()]),
            match_type: MatchType::Exact,
            filters: Some(DocumentFilters {
                file_types: vec!["pdf".to_string(), "docx".to_string()],
                document_ids: vec![],
                project_ids: vec![],
                owners: vec![],
            }),
            search_on: SearchOn::Content,
            collapse: None,
        };

        let json = serde_json::to_string(&request).expect("Failed to serialize to JSON");
        let expected = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","file_types":["pdf","docx"],"search_on":"content"}"#;

        assert_eq!(json, expected);
    }

    #[test]
    fn test_document_search_request_json_deserialization() {
        let json = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","file_types":["pdf","docx"]}"#;

        let request: DocumentSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize from JSON");

        assert_eq!(request.query, Some("test query".to_string()));
        assert_eq!(
            request.terms,
            Some(vec!["term1".to_string(), "term2".to_string()])
        );
        assert_eq!(request.match_type, MatchType::Exact);
        assert_eq!(
            request.filters.as_ref().unwrap().file_types,
            vec!["pdf".to_string(), "docx".to_string()]
        );
    }

    #[test]
    fn test_document_search_request_minimal_json() {
        let json = r#"{"match_type":"partial"}"#;

        let request: DocumentSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize minimal JSON");

        assert_eq!(request.query, None);
        assert_eq!(request.terms, None);
        assert_eq!(request.match_type, MatchType::Partial);
        // With #[serde(flatten)], filters will be Some(DocumentFilters::default()) even when no filter fields are present
        assert_eq!(request.filters, Some(DocumentFilters::default()));
    }

    #[test]
    fn test_document_search_request_all_match_types() {
        let test_cases = vec![
            ("exact", MatchType::Exact),
            ("partial", MatchType::Partial),
            ("query", MatchType::Query),
        ];

        for (json_value, expected_match_type) in test_cases {
            let json = format!(r#"{{"match_type":"{}"}}"#, json_value);
            let request: DocumentSearchRequest = serde_json::from_str(&json)
                .unwrap_or_else(|_| panic!("Failed to deserialize match_type: {}", json_value));

            assert_eq!(request.match_type, expected_match_type);
        }
    }

    #[test]
    fn test_document_search_request_round_trip() {
        let original = DocumentSearchRequest {
            query: Some("search term".to_string()),
            terms: None,
            match_type: MatchType::Query,
            filters: Some(DocumentFilters {
                file_types: vec!["txt".to_string(), "md".to_string()],
                document_ids: vec![],
                project_ids: vec![],
                owners: vec![],
            }),
            search_on: SearchOn::Content,
            collapse: None,
        };

        let json = serde_json::to_string(&original).expect("Failed to serialize");
        let deserialized: DocumentSearchRequest =
            serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(original.query, deserialized.query);
        assert_eq!(original.terms, deserialized.terms);
        assert_eq!(original.match_type, deserialized.match_type);
        assert_eq!(original.filters, deserialized.filters);
    }

    #[test]
    fn test_document_search_request_empty_arrays() {
        let json = r#"{"query":"test","terms":[],"match_type":"exact","file_types":[]}"#;

        let request: DocumentSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize empty arrays");

        assert_eq!(request.query, Some("test".to_string()));
        assert_eq!(request.terms, Some(vec![]));
        assert_eq!(request.match_type, MatchType::Exact);
        assert!(request.filters.as_ref().unwrap().file_types.is_empty());
    }

    #[test]
    fn test_document_search_request_with_file_types_only() {
        let json = r#"{"match_type":"partial","file_types":["pdf","docx","txt"]}"#;

        let request: DocumentSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize with file_types only");

        assert_eq!(request.query, None);
        assert_eq!(request.terms, None);
        assert_eq!(request.match_type, MatchType::Partial);
        assert_eq!(
            request.filters.as_ref().unwrap().file_types,
            vec!["pdf".to_string(), "docx".to_string(), "txt".to_string()]
        );
    }

    #[test]
    fn test_document_search_request_with_query_and_terms() {
        let json =
            r#"{"query":"main query","terms":["term1","term2","term3"],"match_type":"query"}"#;

        let request: DocumentSearchRequest =
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
        assert_eq!(request.filters, Some(DocumentFilters::default()));
    }

    #[test]
    fn test_document_search_request_invalid_match_type() {
        let json = r#"{"match_type":"invalid"}"#;

        let result = serde_json::from_str::<DocumentSearchRequest>(json);
        assert!(
            result.is_err(),
            "Should fail to deserialize invalid match_type"
        );
    }

    #[test]
    fn test_document_search_request_missing_required_field() {
        let json = r#"{"query":"test"}"#;

        let result = serde_json::from_str::<DocumentSearchRequest>(json);
        assert!(
            result.is_err(),
            "Should fail to deserialize without required match_type field"
        );
    }

    #[test]
    fn test_document_search_request_filters_only() {
        let json = r#"{"match_type":"exact","file_types":["pdf"]}"#;

        let request: DocumentSearchRequest =
            serde_json::from_str(json).expect("Failed to deserialize filters only");

        assert_eq!(request.query, None);
        assert_eq!(request.terms, None);
        assert_eq!(request.match_type, MatchType::Exact);
        assert_eq!(
            request.filters.as_ref().unwrap().file_types,
            vec!["pdf".to_string()]
        );
    }
}
