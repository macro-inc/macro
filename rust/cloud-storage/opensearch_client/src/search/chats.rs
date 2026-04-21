use crate::{
    Result, delegate_methods,
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        utils::should_wildcard_field_query_builder,
    },
};

use models_opensearch::OpenSearchEntityType;
use opensearch_query_builder::BoolQueryBuilder;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ChatIndex {
    pub entity_id: uuid::Uuid,
    pub chat_message_id: uuid::Uuid,
    pub user_id: String,
    pub role: String,
    pub title: String,
    pub updated_at_seconds: Option<i64>,
}

pub(crate) struct ChatSearchConfig;

impl SearchQueryConfig for ChatSearchConfig {
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::Chats;
}

pub(crate) struct ChatQueryBuilder {
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
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    pub fn role(mut self, role: Vec<String>) -> Self {
        self.role = role;
        self
    }

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        let mut content_bool_query = self.inner.build_content_bool_query()?;

        // CUSTOM ATTRIBUTES SECTION
        // Add role to must clause if provided
        if !self.role.is_empty() {
            let should_query = should_wildcard_field_query_builder("role", &self.role);
            content_bool_query.filter(should_query);
        }
        // END CUSTOM ATTRIBUTES SECTION

        Ok(content_bool_query)
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
    pub collapse: bool,
    pub ids_only: bool,
}

impl From<ChatSearchArgs> for ChatQueryBuilder {
    fn from(args: ChatSearchArgs) -> Self {
        ChatQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .ids(args.chat_ids)
            .role(args.role)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
    }
}

#[cfg(test)]
mod test;
