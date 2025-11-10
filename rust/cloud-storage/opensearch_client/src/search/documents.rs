use crate::{
    DOCUMENTS_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{DefaultHit, DefaultSearchResponse},
    },
};

use crate::SearchOn;
use opensearch_query_builder::{BoolQueryBuilder, FieldSort, QueryType, SortOrder, SortType};
use serde_json::Value;

#[derive(Clone)]
struct DocumentSearchConfig;

impl SearchQueryConfig for DocumentSearchConfig {
    const ID_KEY: &'static str = "document_id";
    const INDEX: &'static str = DOCUMENTS_INDEX;
    const USER_ID_KEY: &'static str = "owner_id";
    const TITLE_KEY: &'static str = "document_name";

    fn default_sort_types() -> Vec<SortType> {
        vec![
            SortType::Field(FieldSort::new("updated_at_seconds", SortOrder::Desc)),
            SortType::Field(FieldSort::new(Self::ID_KEY, SortOrder::Asc)),
            SortType::Field(FieldSort::new("node_id", SortOrder::Asc)),
        ]
    }
}

struct DocumentQueryBuilder {
    inner: SearchQueryBuilder<DocumentSearchConfig>,
    /// File types to filter by
    file_types: Vec<String>,
}

impl DocumentQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            file_types: Vec::new(),
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

    pub fn file_types(mut self, file_types: Vec<String>) -> Self {
        self.file_types = file_types;
        self
    }

    fn query_builder(self) -> Result<(SearchQueryBuilder<DocumentSearchConfig>, BoolQueryBuilder)> {
        let mut query_object = self.inner.query_builder()?;
        // Add in file types to must query
        if !self.file_types.is_empty() {
            query_object.must(QueryType::terms("file_type", self.file_types));
        }
        Ok((self.inner, query_object))
    }

    pub fn build(self) -> Result<Value> {
        let (builder, query_object) = self.query_builder()?;
        let base_query = builder.build_with_query(query_object.build().into())?;

        Ok(base_query)
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct DocumentIndex {
    pub document_id: String,
    pub document_name: String,
    pub node_id: String,
    pub raw_content: Option<String>,
    pub content: String,
    pub owner_id: String,
    pub file_type: String,
    pub updated_at_seconds: i64,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct DocumentSearchResponse {
    pub document_id: String,
    pub document_name: String,
    pub node_id: String,
    pub owner_id: String,
    pub file_type: String,
    pub updated_at: i64,
    pub content: Option<Vec<String>>,
    pub raw_content: Option<String>,
}

#[derive(Debug)]
pub struct DocumentSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub document_ids: Vec<String>,
    pub file_types: Vec<String>,
    pub page: i64,
    pub page_size: i64,
    pub match_type: String,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
}

impl DocumentSearchArgs {
    pub fn build(self) -> Result<Value> {
        DocumentQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .ids(self.document_ids)
            .file_types(self.file_types)
            .search_on(self.search_on)
            .collapse(self.collapse)
            .ids_only(self.ids_only)
            .build()
    }
}

impl From<DefaultHit<DocumentIndex>> for DocumentSearchResponse {
    fn from(hit: DefaultHit<DocumentIndex>) -> Self {
        Self {
            document_id: hit._source.document_id,
            node_id: hit._source.node_id,
            document_name: hit._source.document_name,
            owner_id: hit._source.owner_id,
            file_type: hit._source.file_type,
            updated_at: hit._source.updated_at_seconds,
            content: hit.highlight.map(|h| h.content),
            raw_content: hit._source.raw_content,
        }
    }
}

pub(crate) async fn search_documents(
    client: &opensearch::OpenSearch,
    args: DocumentSearchArgs,
) -> Result<Vec<DocumentSearchResponse>> {
    let query_body = args.build()?;

    let response = client
        .search(opensearch::SearchParts::Index(&[DOCUMENTS_INDEX]))
        .body(query_body)
        .send()
        .await
        .map_client_error()
        .await?;

    let result = response
        .json::<DefaultSearchResponse<DocumentIndex>>()
        .await
        .map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_documents".to_string()),
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(DocumentSearchResponse::from)
        .collect())
}

#[cfg(test)]
mod tests {}
