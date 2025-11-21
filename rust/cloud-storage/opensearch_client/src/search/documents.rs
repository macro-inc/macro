use crate::{
    Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{DefaultSearchResponse, Highlight, parse_highlight_hit},
        query::Keys,
    },
};

use crate::SearchOn;
use models_opensearch::SearchIndex;
use opensearch_query_builder::{
    BoolQueryBuilder, FieldSort, ScoreWithOrderSort, SearchRequest, SortOrder, SortType,
    ToOpenSearchJson,
};
use serde_json::Value;

#[derive(Clone)]
pub(crate) struct DocumentSearchConfig;

impl SearchQueryConfig for DocumentSearchConfig {
    const USER_ID_KEY: &'static str = "owner_id";
    const TITLE_KEY: &'static str = "document_name";

    fn default_sort_types() -> Vec<SortType<'static>> {
        vec![
            SortType::ScoreWithOrder(ScoreWithOrderSort::new(SortOrder::Desc)),
            SortType::Field(FieldSort::new(Self::ID_KEY, SortOrder::Asc)),
            SortType::Field(FieldSort::new("node_id", SortOrder::Asc)),
        ]
    }
}

pub(crate) struct DocumentQueryBuilder {
    inner: SearchQueryBuilder<DocumentSearchConfig>,
}

impl DocumentQueryBuilder {
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
        self.inner.build_bool_query()
    }

    fn build_search_request(self) -> Result<SearchRequest<'static>> {
        // Build the search request with the bool query
        // This will automatically wrap the bool query in a function score if
        // SearchOn::NameContent is used
        let search_request = self
            .inner
            .build_search_request(self.build_bool_query()?.build())?;

        Ok(search_request)
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct DocumentIndex {
    pub entity_id: String,
    pub document_name: String,
    pub node_id: String,
    pub raw_content: Option<String>,
    pub content: String,
    pub owner_id: String,
    pub file_type: String,
    pub updated_at_seconds: i64,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct DocumentSearchResponse {
    pub document_id: String,
    pub document_name: String,
    pub node_id: String,
    pub owner_id: String,
    pub file_type: String,
    pub updated_at: i64,
    /// Contains the highlight matches for the document name and content
    pub highlight: Highlight,
    pub raw_content: Option<String>,
    pub score: Option<f64>,
}

#[derive(Debug)]
pub struct DocumentSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub document_ids: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
    pub disable_recency: bool,
}

impl From<DocumentSearchArgs> for DocumentQueryBuilder {
    fn from(args: DocumentSearchArgs) -> Self {
        DocumentQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .ids(args.document_ids)
            .search_on(args.search_on)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
            .disable_recency(args.disable_recency)
    }
}

impl DocumentSearchArgs {
    pub fn build(self) -> Result<Value> {
        let builder: DocumentQueryBuilder = self.into();
        Ok(builder.build_search_request()?.to_json())
    }
}

#[tracing::instrument(skip(client, args), err)]
pub(crate) async fn search_documents(
    client: &opensearch::OpenSearch,
    args: DocumentSearchArgs,
) -> Result<Vec<DocumentSearchResponse>> {
    let query_body = args.build()?;

    tracing::trace!("query: {}", query_body);

    let response = client
        .search(opensearch::SearchParts::Index(&[
            SearchIndex::Documents.as_ref()
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

    let result: DefaultSearchResponse<DocumentIndex> =
        serde_json::from_slice(&bytes).map_err(|e| {
            OpensearchClientError::SearchDeserializationFailed {
                details: e.to_string(),
                raw_body: String::from_utf8_lossy(&bytes).to_string(),
            }
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| DocumentSearchResponse {
            document_id: hit.source.entity_id,
            node_id: hit.source.node_id,
            document_name: hit.source.document_name,
            owner_id: hit.source.owner_id,
            file_type: hit.source.file_type,
            updated_at: hit.source.updated_at_seconds,
            raw_content: hit.source.raw_content,
            score: hit.score,
            highlight: hit
                .highlight
                .map(|h| {
                    parse_highlight_hit(
                        h,
                        Keys {
                            title_key: DocumentSearchConfig::TITLE_KEY,
                            content_key: DocumentSearchConfig::CONTENT_KEY,
                        },
                    )
                })
                .unwrap_or_default(),
        })
        .collect())
}

#[cfg(test)]
mod test;
