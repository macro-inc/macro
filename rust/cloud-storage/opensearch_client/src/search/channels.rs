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
use models_opensearch::{SearchEntityType, SearchIndex};
use opensearch_query_builder::{
    BoolQueryBuilder, FieldSort, QueryType, ScoreWithOrderSort, SearchRequest, SortOrder, SortType,
    ToOpenSearchJson,
};
use serde_json::Value;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ChannelMessageIndex {
    pub entity_id: String,
    pub channel_type: String,
    pub org_id: Option<i64>,
    pub message_id: String,
    pub thread_id: Option<String>,
    pub sender_id: String,
    pub mentions: Vec<String>,
    pub content: String,
    pub created_at_seconds: i64,
    pub updated_at_seconds: i64,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ChannelMessageSearchResponse {
    pub channel_id: String,
    pub channel_type: String,
    pub org_id: Option<i64>,
    pub message_id: String,
    pub thread_id: Option<String>,
    pub sender_id: String,
    pub mentions: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    /// Contains the highlight matches for the channel name and content
    pub highlight: Highlight,
}

#[derive(Default)]
pub(crate) struct ChannelMessageSearchConfig;

impl SearchQueryConfig for ChannelMessageSearchConfig {
    const USER_ID_KEY: &'static str = "sender_id";
    const TITLE_KEY: &'static str = "name";
    const ENTITY_INDEX: SearchEntityType = SearchEntityType::Channels;

    fn default_sort_types<'a>() -> Vec<SortType<'a>> {
        vec![
            SortType::ScoreWithOrder(ScoreWithOrderSort::new(SortOrder::Desc)),
            SortType::Field(FieldSort::new(Self::ID_KEY, SortOrder::Asc)),
            SortType::Field(FieldSort::new("message_id", SortOrder::Asc)),
        ]
    }
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
        fn search_on(search_on: SearchOn) -> Self;
        fn ids_only(ids_only: bool) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn disable_recency(disable_recency: bool) -> Self;
    }

    /// Builds the main bool query for the index
    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        let mut content_and_name_bool_queries = self.inner.build_content_and_name_bool_query()?;

        // CUSTOM ATTRIBUTES SECTION
        if self.inner.search_on == SearchOn::Content
            || self.inner.search_on == SearchOn::NameContent
        {
            let mut bool_query = content_and_name_bool_queries
                .content_bool_query
                .ok_or(OpensearchClientError::BoolQueryNotBuilt)?;

            // Add thread_ids to must clause if provided
            if !self.thread_ids.is_empty() {
                bool_query.must(QueryType::terms("thread_id", self.thread_ids.clone()));
            }

            // Add mentions to must clause if provided
            if !self.mentions.is_empty() {
                bool_query.must(QueryType::terms("mentions", self.mentions.clone()));
            }

            // Add sender_ids to must clause if provided
            if !self.sender_ids.is_empty() {
                bool_query.must(QueryType::terms("sender_id", self.sender_ids.clone()));
            }

            content_and_name_bool_queries.content_bool_query = Some(bool_query);
        }
        // END CUSTOM ATTRIBUTES SECTION

        let bool_query = self.inner.build_bool_query(content_and_name_bool_queries)?;

        Ok(bool_query)
    }

    fn build_search_request<'a>(&'a self) -> Result<SearchRequest<'a>> {
        let bool_query = self.build_bool_query()?;

        // Build the search request with the bool query
        // This will automatically wrap the bool query in a function score if
        // SearchOn::NameContent is used
        let search_request = self.inner.build_search_request(bool_query.build())?;

        Ok(search_request)
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
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
    pub disable_recency: bool,
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
            .search_on(args.search_on)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
            .sender_ids(args.sender_ids)
            .disable_recency(args.disable_recency)
    }
}

impl ChannelMessageSearchArgs {
    pub fn build(self) -> Result<Value> {
        let builder: ChannelMessageQueryBuilder = self.into();

        Ok(builder.build_search_request()?.to_json())
    }
}

#[tracing::instrument(skip(client, args), err)]
pub(crate) async fn search_channel_messages(
    client: &opensearch::OpenSearch,
    args: ChannelMessageSearchArgs,
) -> Result<Vec<ChannelMessageSearchResponse>> {
    let query_body = args.build()?;

    let response = client
        .search(opensearch::SearchParts::Index(&[
            SearchIndex::Channels.as_ref()
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

    let result: DefaultSearchResponse<ChannelMessageIndex> = serde_json::from_slice(&bytes)
        .map_err(|e| OpensearchClientError::SearchDeserializationFailed {
            details: e.to_string(),
            raw_body: String::from_utf8_lossy(&bytes).to_string(),
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| ChannelMessageSearchResponse {
            channel_id: hit.source.entity_id,
            channel_type: hit.source.channel_type,
            org_id: hit.source.org_id,
            message_id: hit.source.message_id,
            thread_id: hit.source.thread_id,
            sender_id: hit.source.sender_id,
            mentions: hit.source.mentions,
            created_at: hit.source.created_at_seconds,
            updated_at: hit.source.updated_at_seconds,
            score: hit.score,
            highlight: hit
                .highlight
                .map(|h| {
                    parse_highlight_hit(
                        h,
                        Keys {
                            title_key: ChannelMessageSearchConfig::TITLE_KEY,
                            content_key: ChannelMessageSearchConfig::CONTENT_KEY,
                        },
                    )
                })
                .unwrap_or_default(),
        })
        .collect())
}

#[cfg(test)]
mod test;
