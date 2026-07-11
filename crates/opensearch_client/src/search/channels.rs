pub use crate::search::builder::ChannelSortMode;

use crate::{
    Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig, thread_sort, updated_at_sort},
        model::{
            DefaultSearchResponse, Hit, MacroEm, SearchGotoChannel, SearchGotoContent, SearchHit,
            exclude_source_content, inject_fragment_size, parse_highlight_hit,
        },
        query::{Keys, TermCombine},
    },
};

use chrono::{DateTime, Utc};
use models_opensearch::{OpenSearchEntityType, SearchEntityType, SearchIndex};
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use opensearch_query_builder::*;
use tracing::Instrument;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ChannelMessageIndex {
    pub entity_id: uuid::Uuid,
    pub channel_type: String,
    pub org_id: Option<i64>,
    pub message_id: uuid::Uuid,
    /// Threadless messages are indexed with `thread_id == message_id`.
    pub thread_id: uuid::Uuid,
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
            // Channel messages are single-doc-per-message, so every term
            // must match the same document.
            inner: SearchQueryBuilder::new(terms).term_combine(TermCombine::And),
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

/// Args for the dedicated channel content search endpoint.
#[derive(Debug, Default, Clone)]
pub struct ChannelSearchArgs {
    pub user_id: String,
    pub page_size: u32,
    pub match_type: String,
    pub cursor: SearchCursorOption,
    pub terms: Vec<String>,
    pub channel_ids: Vec<String>,
    pub thread_ids: Vec<String>,
    pub mentions: Vec<String>,
    pub sender_ids: Vec<String>,
    pub sort_mode: ChannelSortMode,
}

fn build_channel_search_request(
    args: &ChannelSearchArgs,
) -> Result<opensearch_query_builder::SearchRequest<'static>> {
    let channel_search_args = ChannelMessageSearchArgs {
        terms: args.terms.clone(),
        user_id: args.user_id.clone(),
        page: 0,
        page_size: args.page_size,
        match_type: args.match_type.clone(),
        collapse: false,
        ids_only: true,
        channel_ids: args.channel_ids.clone(),
        thread_ids: args.thread_ids.clone(),
        mentions: args.mentions.clone(),
        sender_ids: args.sender_ids.clone(),
    };

    let query_builder: ChannelMessageQueryBuilder = channel_search_args.into();
    let bool_query = query_builder.build_bool_query()?;
    let query: QueryType = bool_query.build().into();
    let query = query.to_owned();

    let mut request_builder = SearchRequestBuilder::new();
    request_builder.size(args.page_size + 1);
    request_builder.query(query);

    if let SearchCursorOption::NotDone(Some(cursor)) = &args.cursor {
        request_builder.set_search_after(cursor.search_after());
    }

    let sort = match args.sort_mode {
        ChannelSortMode::Message => updated_at_sort(),
        ChannelSortMode::Thread => thread_sort(),
    };
    for s in sort {
        request_builder.add_sort(s);
    }

    let em_field = || {
        HighlightField::new()
            .highlight_type("plain")
            .pre_tags(vec![MacroEm::Open.to_string()])
            .post_tags(vec![MacroEm::Close.to_string()])
    };
    let highlight = Highlight::new()
        .require_field_match(true)
        .field("content", em_field().number_of_fragments(1));
    request_builder.highlight(highlight);

    Ok(request_builder.build())
}

pub struct ChannelSearchResults {
    pub hits: Vec<SearchHit>,
    pub next_cursor: SearchCursorOption,
    pub total: i64,
}

#[tracing::instrument(skip(client, args), err)]
pub(crate) async fn search_channel(
    client: &opensearch::OpenSearch,
    args: ChannelSearchArgs,
) -> Result<ChannelSearchResults> {
    let mut search_request = build_channel_search_request(&args)?.to_json();
    inject_fragment_size(&mut search_request, 1000);
    exclude_source_content(&mut search_request);

    let index = SearchIndex::Channels.as_ref();
    let response = async {
        client
            .search(opensearch::SearchParts::Index(&[index]))
            .body(search_request)
            .send()
            .await
            .map_client_error()
            .await
    }
    .instrument(tracing::info_span!("opensearch_http_request"))
    .await?;

    let bytes = async {
        response
            .bytes()
            .await
            .map_err(|e| OpensearchClientError::HttpBytesError {
                details: e.to_string(),
            })
    }
    .instrument(tracing::info_span!("opensearch_read_response_body"))
    .await?;

    let result: DefaultSearchResponse<ChannelMessageIndex> = serde_json::from_slice(&bytes)
        .map_err(|e| OpensearchClientError::SearchDeserializationFailed {
            details: e.to_string(),
            raw_body: String::from_utf8_lossy(&bytes).to_string(),
        })?;

    let total = result.hits.total.value;

    let mut hits: Vec<SearchHit> = result
        .hits
        .hits
        .into_iter()
        .map(channel_hit_to_search_hit)
        .collect();

    let has_more = hits.len() > args.page_size as usize;
    if has_more {
        hits.pop();
    }

    let next_cursor = if has_more {
        let last_cursor = hits
            .last()
            .and_then(|last| build_channel_cursor(last, args.sort_mode));
        SearchCursorOption::NotDone(last_cursor)
    } else {
        SearchCursorOption::Done
    };

    Ok(ChannelSearchResults {
        hits,
        next_cursor,
        total,
    })
}

fn channel_hit_to_search_hit(hit: Hit<ChannelMessageIndex>) -> SearchHit {
    let a = hit.source;
    let highlight = hit
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
        .unwrap_or_default();
    SearchHit {
        entity_id: a.entity_id,
        entity_type: SearchEntityType::Channels,
        score: hit.score,
        highlight,
        goto: Some(SearchGotoContent::Channels(SearchGotoChannel {
            channel_message_id: a.message_id,
            thread_id: (a.thread_id != a.message_id).then_some(a.thread_id),
            sender_id: a.sender_id,
            created_at: DateTime::from_timestamp(a.created_at_seconds, 0).unwrap_or_default(),
            updated_at: DateTime::from_timestamp(a.updated_at_seconds, 0).unwrap_or_default(),
        })),
        updated_at: DateTime::from_timestamp(a.updated_at_seconds, 0),
    }
}

fn build_channel_cursor(last: &SearchHit, mode: ChannelSortMode) -> Option<SearchMethodCursor> {
    match mode {
        ChannelSortMode::Message => Some(SearchMethodCursor::UpdatedAt {
            entity_id: last.entity_id,
            updated_at: last.updated_at.unwrap_or_else(Utc::now),
        }),
        ChannelSortMode::Thread => match &last.goto {
            Some(SearchGotoContent::Channels(ch)) => Some(SearchMethodCursor::Thread {
                thread_id: ch.thread_id.unwrap_or(ch.channel_message_id),
                message_id: ch.channel_message_id,
            }),
            _ => None,
        },
    }
}

#[cfg(test)]
mod test;
