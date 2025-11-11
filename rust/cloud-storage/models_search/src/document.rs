use item_filters::DocumentFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{MatchType, SearchHighlight, SearchOn, SearchResponseItem};

/// A document match for a given node
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DocumentSearchResult {
    /// The node id for the document.
    /// This is only useful for markdown at the moment
    pub node_id: String,
    /// The highlights for the document
    pub highlight: SearchHighlight,
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
    /// The highlights on the document
    pub highlight: SearchHighlight,
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
            highlight: response.highlight.into(),
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
mod test;
