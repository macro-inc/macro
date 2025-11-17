use crate::{
    PROJECT_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{Highlight, MacroEm, SearchResponse, parse_highlight_hit},
        query::Keys,
    },
};

use crate::SearchOn;
use opensearch_query_builder::{HighlightField, SearchRequest, ToOpenSearchJson};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Default)]
struct ProjectSearchConfig;

impl SearchQueryConfig for ProjectSearchConfig {
    const INDEX: &'static str = PROJECT_INDEX;
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "project_name";

    // Projects have no "content" to highlight match on, so match on the TITLE_KEY instead
    fn default_highlight() -> opensearch_query_builder::Highlight {
        opensearch_query_builder::Highlight::new()
            .require_field_match(true)
            .field(
                Self::TITLE_KEY,
                HighlightField::new()
                    .highlight_type("unified")
                    .number_of_fragments(1)
                    .pre_tags(vec![MacroEm::Open.to_string()])
                    .post_tags(vec![MacroEm::Close.to_string()]),
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
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn search_on(search_on: SearchOn) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
        fn disable_recency(disable_recency: bool) -> Self;
    }

    fn build_search_request(self) -> Result<SearchRequest> {
        // Build the main bool query containing all terms and any other filters
        let bool_query = self.inner.build_bool_query()?;

        // Build the search request with the bool query
        // This will automatically wrap the bool query in a function score if
        // SearchOn::NameContent is used
        let search_request = self.inner.build_search_request(bool_query.build())?;

        Ok(search_request)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectIndex {
    pub entity_id: String,
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
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub project_ids: Vec<String>,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
    pub disable_recency: bool,
}

impl ProjectSearchArgs {
    pub fn build(self) -> Result<Value> {
        Ok(ProjectQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .search_on(self.search_on)
            .collapse(self.collapse)
            .ids(self.project_ids)
            .ids_only(self.ids_only)
            .disable_recency(self.disable_recency)
            .build_search_request()?
            .to_json())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectSearchResponse {
    pub project_id: String,
    pub user_id: String,
    pub project_name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub highlight: Highlight,
}

#[tracing::instrument(skip(client, args), err)]
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

    let result: SearchResponse<ProjectIndex> = serde_json::from_value(json_value).map_err(|e| {
        OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_projects".to_string()),
        }
    })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| ProjectSearchResponse {
            project_id: hit._source.entity_id,
            user_id: hit._source.user_id,
            project_name: hit._source.project_name,
            created_at: hit._source.created_at_seconds,
            updated_at: hit._source.updated_at_seconds,
            highlight: hit
                .highlight
                .map(|h| {
                    parse_highlight_hit(
                        h,
                        Keys {
                            title_key: ProjectSearchConfig::TITLE_KEY,
                            content_key: ProjectSearchConfig::CONTENT_KEY,
                        },
                    )
                })
                .unwrap_or_default(),
        })
        .collect())
}

#[cfg(test)]
mod test;
