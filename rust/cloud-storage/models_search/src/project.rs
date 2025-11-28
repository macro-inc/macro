use crate::{MatchType, SearchHighlight, SearchOn, SearchResponse, SearchResponseItem};
use item_filters::ProjectFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ProjectSearchResult {
    pub highlight: SearchHighlight,
    /// The score of the result
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

/// Metadata associated with Project Search, to be used with SearchResponseItem
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ProjectSearchMetadata {
    pub project_id: String,
    pub owner_id: String,
    pub updated_at: i64,
    pub created_at: i64,
    pub project_name: String,
}

/// A single response item, part of the ProjectSearchResponse object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ProjectSearchResponseItem {
    /// Standardized fields that all item types will share.
    /// These field names are being aligned across all item types
    /// for consistency in our data model.
    pub id: String,
    pub name: String,
    pub owner_id: String,

    pub updated_at: i64,
    pub created_at: i64,
    pub project_search_results: Vec<ProjectSearchResult>,
}

/// Metadata for a project fetched from the database
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ProjectMetadata {
    pub created_at: i64,
    pub updated_at: i64,
    pub viewed_at: Option<i64>,
    pub parent_project_id: Option<String>,
    pub deleted_at: Option<i64>,
}

/// ProjectSearchResponseItem object with project metadata we fetch from macrodb. we don't store these
/// timestamps in opensearch as they would require us to update the project record
/// every time the project updates (specifically for updated_at and viewed_at)
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ProjectSearchResponseItemWithMetadata {
    /// Metadata from the database. None if the project doesn't exist in the database.
    pub metadata: Option<ProjectMetadata>,
    #[serde(flatten)]
    pub extra: ProjectSearchResponseItem,
}

impl From<SearchResponseItem<ProjectSearchResult, ProjectSearchMetadata>>
    for ProjectSearchResponseItem
{
    fn from(response: SearchResponseItem<ProjectSearchResult, ProjectSearchMetadata>) -> Self {
        ProjectSearchResponseItem {
            id: response.metadata.project_id,
            name: response.metadata.project_name,
            owner_id: response.metadata.owner_id,
            updated_at: response.metadata.updated_at,
            created_at: response.metadata.created_at,
            project_search_results: response.results,
        }
    }
}

/// Project Search Response
pub type ProjectSearchResponse = SearchResponse<ProjectSearchResponseItemWithMetadata>;

#[derive(Serialize, Deserialize, Debug, ToSchema, JsonSchema)]
pub struct ProjectSearchRequest {
    /// The query to search for
    pub query: Option<String>,
    /// Multiple terms to search over
    pub terms: Option<Vec<String>>,
    /// The match type to use when searching
    pub match_type: MatchType,
    /// If search_on is set to NameContent, you can disable the recency filter
    /// by setting to true.
    #[serde(default)]
    pub disable_recency: bool,
    /// Search filters for chat
    #[serde(flatten)]
    pub filters: Option<ProjectFilters>,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,
    /// If true, returns only 1 result per entity. False by default.
    pub collapse: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleProjectSearchResponseBaseItem<T> {
    /// The project id
    pub project_id: String,
    #[schema(inline)]
    /// The time the project was last updated
    pub updated_at: T,
    #[schema(inline)]
    /// The time the project was created
    pub created_at: T,
    /// The project name
    pub project_name: String,
    /// The id of the user who created the project
    pub user_id: String,
    /// The highlights on the project
    pub highlight: SearchHighlight,
}

pub type SimpleProjectSearchResponseItem =
    SimpleProjectSearchResponseBaseItem<crate::TimestampSeconds>;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleProjectSearchResponse {
    /// List containing results from projects.
    /// Each item in the list is for a specific project.
    pub results: Vec<SimpleProjectSearchResponseItem>,
}
