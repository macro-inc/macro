use crate::{
    Result, delegate_methods,
    search::builder::{SearchQueryBuilder, SearchQueryConfig},
};

use models_opensearch::OpenSearchEntityType;
use opensearch_query_builder::{BoolQueryBuilder, QueryType};

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ChannelMessageIndex {
    pub entity_id: uuid::Uuid,
    pub channel_type: String,
    pub org_id: Option<i64>,
    pub message_id: uuid::Uuid,
    pub thread_id: Option<uuid::Uuid>,
    pub sender_id: String,
    pub mentions: Vec<String>,
    pub created_at_seconds: i64,
    pub updated_at_seconds: i64,
}

#[derive(Default)]
pub(crate) struct ChannelMessageSearchConfig;

impl SearchQueryConfig for ChannelMessageSearchConfig {
    const USER_ID_KEY: Option<&'static str> = Some("sender_id");
    const TITLE_KEY: &'static str = "name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::Channels;
}

#[derive(Default)]
pub(crate) struct ChannelMessageQueryBuilder {
    inner: SearchQueryBuilder<ChannelMessageSearchConfig>,
    thread_ids: Vec<String>,
    mentions: Vec<String>,
    sender_ids: Vec<String>,
}

impl ChannelMessageQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            ..Default::default()
        }
    }

    pub fn thread_ids(mut self, thread_ids: Vec<String>) -> Self {
        self.thread_ids = thread_ids;
        self
    }

    pub fn mentions(mut self, mentions: Vec<String>) -> Self {
        self.mentions = mentions;
        self
    }

    pub fn sender_ids(mut self, sender_ids: Vec<String>) -> Self {
        self.sender_ids = sender_ids;
        self
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn ids(ids: Vec<String>) -> Self;
        fn match_type(match_type: &str) -> Self;
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn ids_only(ids_only: bool) -> Self;
        fn collapse(collapse: bool) -> Self;
    }

    /// Builds the main bool query for the index
    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        let mut content_bool_query = self.inner.build_content_bool_query()?;

        // CUSTOM ATTRIBUTES SECTION
        // Add thread_ids to must clause if provided
        if !self.thread_ids.is_empty() {
            content_bool_query.filter(QueryType::terms("thread_id", self.thread_ids.clone()));
        }

        // Add mentions to must clause if provided
        if !self.mentions.is_empty() {
            content_bool_query.filter(QueryType::terms("mentions", self.mentions.clone()));
        }

        // Add sender_ids to must clause if provided
        if !self.sender_ids.is_empty() {
            content_bool_query.filter(QueryType::terms("sender_id", self.sender_ids.clone()));
        }
        // END CUSTOM ATTRIBUTES SECTION

        Ok(content_bool_query)
    }
}

#[derive(Debug, Default)]
pub struct ChannelMessageSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub channel_ids: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub thread_ids: Vec<String>,
    pub mentions: Vec<String>,
    pub sender_ids: Vec<String>,
    pub collapse: bool,
    pub ids_only: bool,
}

impl From<ChannelMessageSearchArgs> for ChannelMessageQueryBuilder {
    fn from(args: ChannelMessageSearchArgs) -> Self {
        ChannelMessageQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .thread_ids(args.thread_ids)
            .mentions(args.mentions)
            .ids(args.channel_ids)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
            .sender_ids(args.sender_ids)
    }
}

#[cfg(test)]
mod test;
