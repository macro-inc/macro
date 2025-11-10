use crate::{
    CHAT_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::DefaultSearchResponse,
        utils::should_wildcard_field_query_builder,
    },
};

use crate::SearchOn;
use opensearch_query_builder::{BoolQueryBuilder, FieldSort, SortOrder, SortType};
use serde_json::Value;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ChatIndex {
    pub chat_id: String,
    pub chat_message_id: String,
    pub user_id: String,
    pub role: String,
    pub updated_at_seconds: i64,
    pub title: String,
    pub content: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ChatSearchResponse {
    pub chat_id: String,
    pub chat_message_id: String,
    pub user_id: String,
    pub role: String,
    pub updated_at: i64,
    pub title: String,
    pub content: Option<Vec<String>>,
}

struct ChatSearchConfig;

impl SearchQueryConfig for ChatSearchConfig {
    const ID_KEY: &'static str = "chat_id";
    const INDEX: &'static str = CHAT_INDEX;
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "title";

    fn default_sort_types() -> Vec<SortType> {
        vec![
            SortType::Field(FieldSort::new("updated_at_seconds", SortOrder::Desc)),
            SortType::Field(FieldSort::new(Self::ID_KEY, SortOrder::Asc)),
            SortType::Field(FieldSort::new("chat_message_id", SortOrder::Asc)),
        ]
    }
}

struct ChatQueryBuilder {
    inner: SearchQueryBuilder<ChatSearchConfig>,
    /// The role of the chat message
    role: Vec<String>,
}

impl ChatQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            role: Vec::new(),
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

    pub fn role(mut self, role: Vec<String>) -> Self {
        self.role = role;
        self
    }

    fn query_builder(self) -> Result<(SearchQueryBuilder<ChatSearchConfig>, BoolQueryBuilder)> {
        let mut query_object = self.inner.query_builder()?;
        if !self.role.is_empty() {
            let should_query = should_wildcard_field_query_builder("role", &self.role);
            query_object.must(should_query);
        }
        Ok((self.inner, query_object))
    }

    pub fn build(self) -> Result<Value> {
        let (builder, query_object) = self.query_builder()?;
        let base_query = builder.build_with_query(query_object.build().into())?;
        Ok(base_query)
    }
}

#[derive(Debug)]
pub struct ChatSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub chat_ids: Vec<String>,
    pub page: i64,
    pub page_size: i64,
    pub match_type: String,
    pub role: Vec<String>,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
}

impl ChatSearchArgs {
    pub fn build(self) -> Result<Value> {
        ChatQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .ids(self.chat_ids)
            .role(self.role)
            .search_on(self.search_on)
            .collapse(self.collapse)
            .ids_only(self.ids_only)
            .build()
    }
}

pub(crate) async fn search_chats(
    client: &opensearch::OpenSearch,
    args: ChatSearchArgs,
) -> Result<Vec<ChatSearchResponse>> {
    let query_body = args.build()?;

    let response = client
        .search(opensearch::SearchParts::Index(&[CHAT_INDEX]))
        .body(query_body)
        .send()
        .await
        .map_client_error()
        .await?;

    let result = response
        .json::<DefaultSearchResponse<ChatIndex>>()
        .await
        .map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_chats".to_string()),
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| ChatSearchResponse {
            chat_id: hit._source.chat_id,
            chat_message_id: hit._source.chat_message_id,
            user_id: hit._source.user_id,
            role: hit._source.role,
            title: hit._source.title,
            content: hit.highlight.map(|h| h.content),
            updated_at: hit._source.updated_at_seconds,
        })
        .collect())
}

#[cfg(test)]
mod test;
