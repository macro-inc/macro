use crate::{
    PROJECT_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{Hit, SearchResponse},
    },
};

use crate::SearchOn;
use opensearch_query_builder::{
    BoolQueryBuilder, FieldSort, Highlight, HighlightField, SortOrder, SortType,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Default)]
struct ProjectSearchConfig;

impl SearchQueryConfig for ProjectSearchConfig {
    const ID_KEY: &'static str = "project_id";
    const INDEX: &'static str = PROJECT_INDEX;
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "project_name";

    fn default_sort_types() -> Vec<SortType> {
        vec![
            SortType::Field(FieldSort::new("updated_at_seconds", SortOrder::Desc)),
            SortType::Field(FieldSort::new(Self::ID_KEY, SortOrder::Asc)),
        ]
    }

    // Projects have no "content" to highlight match on, so match on the TITLE_KEY instead
    fn default_highlight() -> Highlight {
        Highlight::new().require_field_match(true).field(
            Self::TITLE_KEY,
            HighlightField::new()
                .highlight_type("unified")
                .number_of_fragments(500)
                .pre_tags(vec!["<macro_em>".to_string()])
                .post_tags(vec!["</macro_em>".to_string()]),
        )
    }
}

#[derive(Default)]
struct ProjectQueryBuilder {
    inner: SearchQueryBuilder<ProjectSearchConfig>,
}

impl ProjectQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
        }
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: i64) -> Self;
        fn page_size(page_size: i64) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn search_on(search_on: SearchOn) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    fn query_builder(self) -> Result<(SearchQueryBuilder<ProjectSearchConfig>, BoolQueryBuilder)> {
        let query_object = self.inner.query_builder()?;

        Ok((self.inner, query_object))
    }

    pub fn build(self) -> Result<Value> {
        let (builder, query_object) = self.query_builder()?;
        let base_query = builder.build_with_query(query_object.build().into())?;

        Ok(base_query)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectIndex {
    pub project_id: String,
    pub user_id: String,
    pub parent_project_id: Option<String>,
    pub project_name: String,
    pub created_at_seconds: i64,
    pub updated_at_seconds: i64,
}

#[derive(Debug, Default)]
pub struct ProjectSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub page: i64,
    pub page_size: i64,
    pub match_type: String,
    pub project_ids: Vec<String>,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
}

impl ProjectSearchArgs {
    pub fn build(self) -> Result<Value> {
        let builder = ProjectQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .search_on(self.search_on)
            .collapse(self.collapse)
            .ids(self.project_ids)
            .ids_only(self.ids_only);
        builder.build()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectSearchResponse {
    pub project_id: String,
    pub user_id: String,
    pub project_name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub content: Option<Vec<String>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct HighlightProject {
    pub project_name: Vec<String>,
}

impl From<Hit<ProjectIndex, HighlightProject>> for ProjectSearchResponse {
    fn from(hit: Hit<ProjectIndex, HighlightProject>) -> Self {
        Self {
            project_id: hit._source.project_id,
            user_id: hit._source.user_id,
            project_name: hit._source.project_name,
            created_at: hit._source.created_at_seconds,
            updated_at: hit._source.updated_at_seconds,
            content: hit.highlight.map(|h| h.project_name),
        }
    }
}

pub(crate) async fn search_projects(
    client: &opensearch::OpenSearch,
    args: ProjectSearchArgs,
) -> Result<Vec<ProjectSearchResponse>> {
    let query_body = args.build()?;

    let response = client
        .search(opensearch::SearchParts::Index(&[PROJECT_INDEX]))
        .body(query_body)
        .send()
        .await
        .map_client_error()
        .await?;

    let json_value: serde_json::Value =
        response
            .json()
            .await
            .map_err(|e| OpensearchClientError::DeserializationFailed {
                details: e.to_string(),
                method: Some("search_projects".to_string()),
            })?;

    let result: SearchResponse<ProjectIndex, HighlightProject> = serde_json::from_value(json_value)
        .map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_projects".to_string()),
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(ProjectSearchResponse::from)
        .collect())
}

#[cfg(test)]
mod test;
