use std::collections::HashSet;

use crate::{
    Result,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryConfig, updated_at_sort},
        call_records::{
            CallRecordIndex, CallRecordQueryBuilder, CallRecordSearchArgs, CallRecordSearchConfig,
        },
        channels::{
            ChannelMessageIndex, ChannelMessageQueryBuilder, ChannelMessageSearchArgs,
            ChannelMessageSearchConfig,
        },
        chats::{ChatIndex, ChatQueryBuilder, ChatSearchArgs, ChatSearchConfig},
        documents::{
            DocumentIndex, DocumentQueryBuilder, DocumentSearchArgs, DocumentSearchConfig,
        },
        emails::{EmailIndex, EmailQueryBuilder, EmailSearchArgs, EmailSearchConfig},
        model::{
            DefaultSearchResponse, Hit, MacroEm, SearchGotoCallRecord, SearchGotoChannel,
            SearchGotoChat, SearchGotoContent, SearchGotoDocument, SearchGotoEmail, SearchHit,
            exclude_source_content, inject_fragment_size, parse_highlight_hit,
        },
        query::Keys,
    },
};
use chrono::{DateTime, Utc};
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use tracing::Instrument;

use models_opensearch::{OpenSearchEntityType, SearchEntityType};
use opensearch_query_builder::*;

impl UnifiedSearchArgs {
    /// Builds the OpenSearch query JSON for this set of search args.
    pub fn to_query_json(&self) -> Result<serde_json::Value> {
        let mut json = build_unified_search_request(self)?.to_json();
        inject_fragment_size(&mut json, 1000);
        exclude_source_content(&mut json);
        Ok(json)
    }
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedSearchArgs {
    pub user_id: String,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub collapse: bool,
    /// The cursor to use
    pub cursor: SearchCursorOption,
    /// The indices to search over
    pub search_indices: HashSet<OpenSearchEntityType>,
    /// The document search args
    pub document_search_args: UnifiedDocumentSearchArgs,
    /// The email search args. If None, we do not search emails
    pub email_search_args: UnifiedEmailSearchArgs,
    /// The channel message search args. If None, we do not search channel messages
    pub channel_message_search_args: UnifiedChannelMessageSearchArgs,
    /// The chat search args. If None, we do not search chats
    pub chat_search_args: UnifiedChatSearchArgs,
    /// The call record search args. If None, we do not search call records
    pub call_record_search_args: UnifiedCallRecordSearchArgs,
}

impl From<UnifiedSearchArgs> for DocumentSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        DocumentSearchArgs {
            terms: args.document_search_args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            collapse: args.collapse,
            ids_only: args.document_search_args.ids_only,
            document_ids: args.document_search_args.document_ids,
            sub_types: args.document_search_args.sub_types,
        }
    }
}

impl From<UnifiedSearchArgs> for EmailSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        EmailSearchArgs {
            terms: args.email_search_args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            collapse: args.collapse,
            ids_only: false, // Email is never ids only at the moment
            thread_ids: args.email_search_args.thread_ids,
            link_ids: args.email_search_args.link_ids,
            sender: args.email_search_args.sender,
            cc: args.email_search_args.cc,
            bcc: args.email_search_args.bcc,
            recipients: args.email_search_args.recipients,
            include_labels: args.email_search_args.include_labels,
            exclude_labels: args.email_search_args.exclude_labels,
            importance: args.email_search_args.importance,
            subject_only: args.email_search_args.subject_only,
        }
    }
}

impl From<UnifiedSearchArgs> for ChannelMessageSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        ChannelMessageSearchArgs {
            terms: args.channel_message_search_args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            collapse: args.collapse,
            ids_only: true, // channel messages are always ids only
            channel_ids: args.channel_message_search_args.channel_ids,
            thread_ids: args.channel_message_search_args.thread_ids,
            mentions: args.channel_message_search_args.mentions,
            sender_ids: args.channel_message_search_args.sender_ids,
        }
    }
}

impl From<UnifiedSearchArgs> for ChatSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        ChatSearchArgs {
            terms: args.chat_search_args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            collapse: args.collapse,
            ids_only: args.chat_search_args.ids_only,
            chat_ids: args.chat_search_args.chat_ids,
            role: args.chat_search_args.role,
        }
    }
}

impl From<UnifiedSearchArgs> for CallRecordSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        CallRecordSearchArgs {
            terms: args.call_record_search_args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            collapse: args.collapse,
            ids_only: args.call_record_search_args.ids_only,
            call_ids: args.call_record_search_args.call_ids,
            channel_ids: args.call_record_search_args.channel_ids,
            speaker_ids: args.call_record_search_args.speaker_ids,
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedChatSearchArgs {
    pub terms: Vec<String>,
    pub chat_ids: Vec<String>,
    pub role: Vec<String>,
    pub ids_only: bool,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedDocumentSearchArgs {
    pub terms: Vec<String>,
    pub document_ids: Vec<String>,
    pub ids_only: bool,
    pub sub_types: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedEmailSearchArgs {
    pub terms: Vec<String>,
    pub thread_ids: Vec<String>,
    pub link_ids: Vec<String>,
    pub sender: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub recipients: Vec<String>,
    pub include_labels: Vec<String>,
    pub exclude_labels: Vec<String>,
    pub importance: Option<bool>,
    pub subject_only: bool,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedChannelMessageSearchArgs {
    pub terms: Vec<String>,
    pub channel_ids: Vec<String>,
    pub thread_ids: Vec<String>,
    pub mentions: Vec<String>,
    pub sender_ids: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedCallRecordSearchArgs {
    pub terms: Vec<String>,
    pub call_ids: Vec<String>,
    pub channel_ids: Vec<String>,
    pub speaker_ids: Vec<String>,
    pub ids_only: bool,
}

/// Possible search result indices for unified search
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub(crate) enum UnifiedSearchIndex {
    ChannelMessage(ChannelMessageIndex),
    Document(DocumentIndex),
    Chat(ChatIndex),
    Email(Box<EmailIndex>),
    CallRecord(CallRecordIndex),
}

pub struct SplitUnifiedSearchResponseValues {
    pub channel_message: Vec<SearchHit>,
    pub chat: Vec<SearchHit>,
    pub document: Vec<SearchHit>,
    pub email: Vec<SearchHit>,
    pub project: Vec<SearchHit>,
    pub call_record: Vec<SearchHit>,
}

pub trait SplitUnifiedSearchResponse: Iterator<Item = SearchHit> {
    fn split_search_response(self) -> SplitUnifiedSearchResponseValues;
}

impl<T> SplitUnifiedSearchResponse for T
where
    T: Iterator<Item = SearchHit>,
{
    fn split_search_response(self) -> SplitUnifiedSearchResponseValues {
        let (channel_message, chat, document, email, project, call_record) = self.into_iter().fold(
            (vec![], vec![], vec![], vec![], vec![], vec![]),
            |(
                mut channel_message,
                mut chat,
                mut document,
                mut email,
                mut project,
                mut call_record,
            ),
             item| {
                match item.entity_type {
                    SearchEntityType::Channels => {
                        channel_message.push(item);
                    }
                    SearchEntityType::Chats => {
                        chat.push(item);
                    }
                    SearchEntityType::Documents => {
                        document.push(item);
                    }
                    SearchEntityType::Emails => {
                        email.push(item);
                    }
                    SearchEntityType::Projects => {
                        project.push(item);
                    }
                    SearchEntityType::CallRecords => {
                        call_record.push(item);
                    }
                }
                (channel_message, chat, document, email, project, call_record)
            },
        );

        SplitUnifiedSearchResponseValues {
            channel_message,
            chat,
            document,
            email,
            project,
            call_record,
        }
    }
}

impl From<Hit<UnifiedSearchIndex>> for SearchHit {
    fn from(index: Hit<UnifiedSearchIndex>) -> Self {
        match index.source {
            UnifiedSearchIndex::ChannelMessage(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: SearchEntityType::Channels,
                score: index.score,
                highlight: index
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
                goto: Some(SearchGotoContent::Channels(SearchGotoChannel {
                    channel_message_id: a.message_id,
                    thread_id: (a.thread_id != a.message_id).then_some(a.thread_id),
                    sender_id: a.sender_id,
                    created_at: DateTime::from_timestamp(a.created_at_seconds, 0)
                        .unwrap_or_default(),
                    updated_at: DateTime::from_timestamp(a.updated_at_seconds, 0)
                        .unwrap_or_default(),
                })),
                updated_at: DateTime::from_timestamp(a.updated_at_seconds, 0),
            },
            UnifiedSearchIndex::Document(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: SearchEntityType::Documents,
                score: index.score,
                highlight: index
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
                goto: Some(SearchGotoContent::Documents(SearchGotoDocument {
                    node_id: a.node_id,
                    raw_content: a.raw_content,
                })),
                updated_at: a
                    .updated_at_seconds
                    .and_then(|s| DateTime::from_timestamp(s, 0)),
            },
            UnifiedSearchIndex::Email(a) => {
                let a = *a;
                SearchHit {
                    entity_id: a.entity_id,
                    entity_type: SearchEntityType::Emails,
                    score: index.score,
                    highlight: index
                        .highlight
                        .map(|h| {
                            parse_highlight_hit(
                                h,
                                Keys {
                                    title_key: EmailSearchConfig::TITLE_KEY,
                                    content_key: EmailSearchConfig::CONTENT_KEY,
                                },
                            )
                        })
                        .unwrap_or_default(),
                    goto: Some(SearchGotoContent::Emails(SearchGotoEmail {
                        email_message_id: a.message_id,
                        bcc: a.bcc,
                        cc: a.cc,
                        labels: a.labels,
                        sent_at: a
                            .sent_at_seconds
                            .and_then(|ts| DateTime::from_timestamp(ts, 0)),
                        sender: a.sender,
                        recipients: a.recipients,
                    })),
                    updated_at: a
                        .sent_at_seconds
                        .and_then(|s| DateTime::from_timestamp(s, 0)),
                }
            }
            UnifiedSearchIndex::Chat(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: SearchEntityType::Chats,
                score: index.score,
                highlight: index
                    .highlight
                    .map(|h| {
                        parse_highlight_hit(
                            h,
                            Keys {
                                title_key: ChatSearchConfig::TITLE_KEY,
                                content_key: ChatSearchConfig::CONTENT_KEY,
                            },
                        )
                    })
                    .unwrap_or_default(),
                goto: Some(SearchGotoContent::Chats(SearchGotoChat {
                    chat_message_id: a.chat_message_id,
                    role: a.role,
                })),
                updated_at: a
                    .updated_at_seconds
                    .and_then(|s| DateTime::from_timestamp(s, 0)),
            },
            UnifiedSearchIndex::CallRecord(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: SearchEntityType::CallRecords,
                score: index.score,
                highlight: index
                    .highlight
                    .map(|h| {
                        parse_highlight_hit(
                            h,
                            Keys {
                                title_key: CallRecordSearchConfig::TITLE_KEY,
                                content_key: CallRecordSearchConfig::CONTENT_KEY,
                            },
                        )
                    })
                    .unwrap_or_default(),
                goto: Some(SearchGotoContent::CallRecords(SearchGotoCallRecord {
                    channel_id: a.channel_id,
                    transcript_id: a.transcript_id,
                    speaker_id: a.speaker_id,
                    sequence_num: a.sequence_num,
                    started_at: DateTime::from_timestamp(a.started_at_seconds, 0)
                        .unwrap_or_default(),
                    ended_at: a
                        .ended_at_seconds
                        .and_then(|s| DateTime::from_timestamp(s, 0)),
                    participant_ids: a.participant_ids,
                })),
                updated_at: DateTime::from_timestamp(a.started_at_seconds, 0),
            },
        }
    }
}

#[tracing::instrument(skip(args), err)]
fn build_unified_search_request(args: &UnifiedSearchArgs) -> Result<SearchRequest<'static>> {
    // We don't support searching over an exhausted (done) cursor
    let cursor = match args.cursor.clone() {
        SearchCursorOption::NotDone(search_method_cursor) => search_method_cursor.clone(),
        SearchCursorOption::Done => return Err(OpensearchClientError::SearchWithExhaustedCursor),
    };

    if args.search_indices.is_empty() {
        return Err(OpensearchClientError::EmptySearchIndices);
    }

    let mut bool_query = BoolQueryBuilder::new();

    // There will always be 1 query as the indices are never empty
    bool_query.minimum_should_match(1);

    if args
        .search_indices
        .contains(&OpenSearchEntityType::Documents)
    {
        let document_search_args: DocumentSearchArgs = args.clone().into();
        let document_query_builder: DocumentQueryBuilder = document_search_args.into();
        let document_bool_query = document_query_builder.build_bool_query()?;
        let query_type: QueryType = document_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    if args.search_indices.contains(&OpenSearchEntityType::Emails) {
        let email_search_args: EmailSearchArgs = args.clone().into();
        let email_query_builder: EmailQueryBuilder = email_search_args.into();
        let email_bool_query = email_query_builder.build_bool_query()?;
        let query_type: QueryType = email_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    if args
        .search_indices
        .contains(&OpenSearchEntityType::Channels)
    {
        let channel_message_search_args: ChannelMessageSearchArgs = args.clone().into();
        let channel_message_query_builder: ChannelMessageQueryBuilder =
            channel_message_search_args.into();
        let channel_message_bool_query = channel_message_query_builder.build_bool_query()?;
        let query_type: QueryType = channel_message_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    if args.search_indices.contains(&OpenSearchEntityType::Chats) {
        let chat_search_args: ChatSearchArgs = args.clone().into();
        let chat_query_builder: ChatQueryBuilder = chat_search_args.into();
        let chat_bool_query = chat_query_builder.build_bool_query()?;
        let query_type: QueryType = chat_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    if args
        .search_indices
        .contains(&OpenSearchEntityType::CallRecords)
    {
        let call_record_search_args: CallRecordSearchArgs = args.clone().into();
        let call_record_query_builder: CallRecordQueryBuilder = call_record_search_args.into();
        let call_record_bool_query = call_record_query_builder.build_bool_query()?;
        let query_type: QueryType = call_record_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    // create the search request
    let mut search_request_builder = SearchRequestBuilder::new();

    if let Some(cursor) = cursor {
        search_request_builder.set_search_after(cursor.search_after());
    }

    search_request_builder.size(args.page_size + 1);

    if args.collapse {
        search_request_builder.collapse(Collapse::new("entity_id"));
    }

    for sort in updated_at_sort() {
        search_request_builder.add_sort(sort);
    }

    let em_field = || {
        HighlightField::new()
            .highlight_type("plain")
            .pre_tags(vec![MacroEm::Open.to_string()])
            .post_tags(vec![MacroEm::Close.to_string()])
    };
    let highlight = Highlight::new()
        .require_field_match(true)
        .field("content", em_field().number_of_fragments(1))
        .field("subject", em_field().number_of_fragments(0))
        .field("sender", em_field().number_of_fragments(0))
        .field("sender_name", em_field().number_of_fragments(0))
        .field("recipients", em_field().number_of_fragments(0))
        .field("recipient_names", em_field().number_of_fragments(0))
        .field("cc", em_field().number_of_fragments(0))
        .field("cc_names", em_field().number_of_fragments(0))
        .field("bcc", em_field().number_of_fragments(0))
        .field("bcc_names", em_field().number_of_fragments(0));

    search_request_builder.highlight(highlight);

    let query_object = bool_query.build();

    let built_query: QueryType = query_object.into();

    search_request_builder.query(built_query);

    Ok(search_request_builder.build())
}

#[tracing::instrument(skip(client, args), err)]
pub(crate) async fn search_unified(
    client: &opensearch::OpenSearch,
    args: UnifiedSearchArgs,
) -> Result<(Vec<SearchHit>, SearchCursorOption)> {
    let mut search_request = build_unified_search_request(&args)?.to_json();
    inject_fragment_size(&mut search_request, 1000);
    exclude_source_content(&mut search_request);

    tracing::trace!("search request {:?}", search_request);

    let search_indices: Vec<&str> = args.search_indices.iter().map(|i| i.index_name()).collect();

    let response = async {
        client
            .search(opensearch::SearchParts::Index(&search_indices))
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

    let result: DefaultSearchResponse<UnifiedSearchIndex> = {
        let _span = tracing::info_span!("opensearch_deserialize_response", body_size = bytes.len())
            .entered();
        serde_json::from_slice(&bytes).map_err(|e| {
            OpensearchClientError::SearchDeserializationFailed {
                details: e.to_string(),
                raw_body: String::from_utf8_lossy(&bytes).to_string(),
            }
        })?
    };

    tracing::info!(
        response_body_bytes = bytes.len(),
        opensearch_took_ms = result.took,
        hit_count = result.hits.hits.len(),
        "opensearch response"
    );

    let mut results: Vec<SearchHit> = result.hits.hits.into_iter().map(|h| h.into()).collect();

    let has_more = results.len() > args.page_size as usize;

    if has_more {
        results.pop(); // Remove the extra item
    }

    let cursor = if has_more {
        SearchCursorOption::NotDone(results.last().map(|last| SearchMethodCursor::UpdatedAt {
            entity_id: last.entity_id,
            updated_at: last.updated_at.unwrap_or_else(Utc::now),
        }))
    } else {
        SearchCursorOption::Done
    };

    Ok((results, cursor))
}

#[cfg(test)]
mod test;
