use crate::{
    Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{Highlight, MacroEm, SearchResponse, parse_highlight_hit},
        query::Keys,
    },
};

use crate::SearchOn;
use models_opensearch::{SearchEntityType, SearchIndex};
use opensearch_query_builder::{BoolQueryBuilder, HighlightField, SearchRequest, ToOpenSearchJson};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Default)]
pub(crate) struct ProjectSearchConfig;

impl SearchQueryConfig for ProjectSearchConfig {
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "project_name";
    const ENTITY_INDEX: SearchEntityType = SearchEntityType::Projects;

    // Projects have no "content" to highlight match on, so match on the TITLE_KEY instead
    fn default_highlight() -> opensearch_query_builder::Highlight<'static> {
        opensearch_query_builder::Highlight::new()
            .require_field_match(true)
            .field(
                // we know the title key exists because it's implemented right above
                Self::TITLE_KEY,
                HighlightField::new()
                    .highlight_type("plain")
                    .number_of_fragments(1)
                    .pre_tags(vec![MacroEm::Open.to_string()])
                    .post_tags(vec![MacroEm::Close.to_string()]),
            )
    }
}

#[derive(Default)]
pub(crate) struct ProjectQueryBuilder {
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

    pub fn build_bool_query(&self) -> Result<BoolQueryBuilder<'static>> {
        self.inner
            .build_bool_query(self.inner.build_content_and_name_bool_query()?)
    }

    fn build_search_request(&self) -> Result<SearchRequest<'static>> {
        // Build the search request with the bool query
        // This will automatically wrap the bool query in a function score if
        // SearchOn::NameContent is used
        let search_request = self
            .inner
            .build_search_request(self.build_bool_query()?.build())?;

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

impl From<ProjectSearchArgs> for ProjectQueryBuilder {
    fn from(args: ProjectSearchArgs) -> Self {
        ProjectQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .search_on(args.search_on)
            .collapse(args.collapse)
            .ids(args.project_ids)
            .ids_only(args.ids_only)
            .disable_recency(args.disable_recency)
    }
}

impl ProjectSearchArgs {
    pub fn build(self) -> Result<Value> {
        let builder: ProjectQueryBuilder = self.into();
        Ok(builder.build_search_request()?.to_json())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectSearchResponse {
    pub project_id: String,
    pub user_id: String,
    pub project_name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub score: Option<f64>,
    pub highlight: Highlight,
}

#[tracing::instrument(skip(client, args), err)]
pub(crate) async fn search_projects(
    client: &opensearch::OpenSearch,
    args: ProjectSearchArgs,
) -> Result<Vec<ProjectSearchResponse>> {
    let query_body = args.build()?;

    let response = client
        .search(opensearch::SearchParts::Index(&[
            SearchIndex::Projects.as_ref()
        ]))
        .body(query_body)
        .send()
        .await
        .map_client_error()
        .await?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| OpensearchClientError::HttpBytesError {
            details: e.to_string(),
        })?;

    let result: SearchResponse<ProjectIndex> = serde_json::from_slice(&bytes).map_err(|e| {
        OpensearchClientError::SearchDeserializationFailed {
            details: e.to_string(),
            raw_body: String::from_utf8_lossy(&bytes).to_string(),
        }
    })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| ProjectSearchResponse {
            project_id: hit.source.entity_id,
            user_id: hit.source.user_id,
            project_name: hit.source.project_name,
            created_at: hit.source.created_at_seconds,
            updated_at: hit.source.updated_at_seconds,
            score: hit.score,
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
