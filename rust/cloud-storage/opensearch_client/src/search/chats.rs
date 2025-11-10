use crate::{
    CHAT_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{DefaultSearchResponse, parse_highlight_hit},
        query::Keys,
        utils::should_wildcard_field_query_builder,
    },
};

use crate::SearchOn;
use opensearch_query_builder::{FieldSort, SearchRequest, SortOrder, SortType, ToOpenSearchJson};
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
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
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

    fn build_search_request(self) -> Result<SearchRequest> {
        // Build the main bool query containing all terms and any other filters
        let mut bool_query = self.inner.build_bool_query()?;

        // CUSTOM ATTRIBUTES SECTION

        // If role is provided, add them to the must query
        if !self.role.is_empty() {
            let should_query = should_wildcard_field_query_builder("role", &self.role);
            bool_query.must(should_query);
        }

        // END CUSTOM ATTRIBUTES SECTION

        // Build the search request with the bool query
        // This will automatically wrap the bool query in a function score if
        // SearchOn::NameContent is used
        let search_request = self.inner.build_search_request(bool_query.build())?;

        Ok(search_request)
    }
}

#[derive(Debug)]
pub struct ChatSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub chat_ids: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub role: Vec<String>,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
}

impl ChatSearchArgs {
    pub fn build(self) -> Result<Value> {
        Ok(ChatQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .ids(self.chat_ids)
            .role(self.role)
            .search_on(self.search_on)
            .collapse(self.collapse)
            .ids_only(self.ids_only)
            .build_search_request()?
            .to_json())
    }
}

pub(crate) async fn search_chats(
    client: &opensearch::OpenSearch,
    args: ChatSearchArgs,
) -> Result<Vec<ChatSearchResponse>> {
    let search_on = args.search_on;
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
            content: hit.highlight.map(|h| {
                parse_highlight_hit(
                    h,
                    Keys {
                        title_key: ChatSearchConfig::TITLE_KEY,
                        content_key: ChatSearchConfig::CONTENT_KEY,
                    },
                    search_on,
                )
            }),
            updated_at: hit._source.updated_at_seconds,
        })
        .collect())
}
