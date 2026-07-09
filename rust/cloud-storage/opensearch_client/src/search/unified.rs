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
            DocumentSearchMode, PropertyFilterArg,
        },
        emails::{EmailIndex, EmailQueryBuilder, EmailSearchArgs, EmailSearchConfig},
        model::{
            DefaultSearchResponse, Hit, MacroEm, SearchGotoCallRecord, SearchGotoChannel,
            SearchGotoContent, SearchGotoEmail, SearchHit, exclude_source_content,
            inject_fragment_size, parse_highlight_hit,
        },
        projects::{ProjectIndex, ProjectQueryBuilder, ProjectSearchArgs, ProjectSearchConfig},
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
    /// The project search args. If None, we do not search projects
    pub project_search_args: UnifiedProjectSearchArgs,
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
            mode: args.document_search_args.mode,
            property_filters: args.document_search_args.property_filters,
            tag_option_ids: args.document_search_args.tag_option_ids,
            match_all_tags: args.document_search_args.match_all_tags,
        }
    }
}

impl From<UnifiedSearchArgs> for EmailSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        EmailSearchArgs {
            terms: args.email_search_args.terms,
            user_id: args.user_id,
            user_ids: args.email_search_args.user_ids,
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
            tag_option_ids: args.email_search_args.tag_option_ids,
            match_all_tags: args.email_search_args.match_all_tags,
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
            tag_option_ids: args.chat_search_args.tag_option_ids,
            match_all_tags: args.chat_search_args.match_all_tags,
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

impl From<UnifiedSearchArgs> for ProjectSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        ProjectSearchArgs {
            terms: args.project_search_args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            collapse: args.collapse,
            ids_only: args.project_search_args.ids_only,
            project_ids: args.project_search_args.project_ids,
            tag_option_ids: args.project_search_args.tag_option_ids,
            match_all_tags: args.project_search_args.match_all_tags,
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedChatSearchArgs {
    pub terms: Vec<String>,
    pub chat_ids: Vec<String>,
    pub role: Vec<String>,
    pub ids_only: bool,
    pub tag_option_ids: Vec<String>,
    pub match_all_tags: bool,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedDocumentSearchArgs {
    pub terms: Vec<String>,
    pub document_ids: Vec<String>,
    pub ids_only: bool,
    pub sub_types: Vec<String>,
    pub mode: DocumentSearchMode,
    pub property_filters: Vec<PropertyFilterArg>,
    pub tag_option_ids: Vec<String>,
    pub match_all_tags: bool,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedEmailSearchArgs {
    pub terms: Vec<String>,
    pub user_ids: Vec<String>,
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
    pub tag_option_ids: Vec<String>,
    pub match_all_tags: bool,
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

#[derive(Debug, Default, Clone)]
pub struct UnifiedProjectSearchArgs {
    pub terms: Vec<String>,
    pub project_ids: Vec<String>,
    pub ids_only: bool,
    pub tag_option_ids: Vec<String>,
    pub match_all_tags: bool,
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
    // Keep last: with `untagged`, earlier variants win and every other doc
    // shape carries required fields (document_name, title, message_id, …)
    // a project doc lacks.
    Project(ProjectIndex),
}

pub struct SplitUnifiedSearchResponseValues {
    pub channel_message: Vec<SearchHit>,
    pub chat: Vec<SearchHit>,
    pub document: Vec<SearchHit>,
    pub email: Vec<SearchHit>,
    pub project: Vec<SearchHit>,
    pub call_record: Vec<SearchHit>,
    pub crm_company: Vec<SearchHit>,
}

pub trait SplitUnifiedSearchResponse: Iterator<Item = SearchHit> {
    fn split_search_response(self) -> SplitUnifiedSearchResponseValues;
}

impl<T> SplitUnifiedSearchResponse for T
where
    T: Iterator<Item = SearchHit>,
{
    fn split_search_response(self) -> SplitUnifiedSearchResponseValues {
        let (channel_message, chat, document, email, project, call_record, crm_company) =
            self.into_iter().fold(
                (vec![], vec![], vec![], vec![], vec![], vec![], vec![]),
                |(
                    mut channel_message,
                    mut chat,
                    mut document,
                    mut email,
                    mut project,
                    mut call_record,
                    mut crm_company,
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
                        SearchEntityType::CrmCompanies => {
                            crm_company.push(item);
                        }
                    }
                    (
                        channel_message,
                        chat,
                        document,
                        email,
                        project,
                        call_record,
                        crm_company,
                    )
                },
            );

        SplitUnifiedSearchResponseValues {
            channel_message,
            chat,
            document,
            email,
            project,
            call_record,
            crm_company,
        }
    }
}

/// Expand one OpenSearch hit into one or more `SearchHit`s.
///
/// For join-shape parents (documents, chats, call records), OpenSearch
/// returns one parent hit per matching root with the matching children
/// nested under `inner_hits`. Each entity's search module knows how to
/// unpack those into child-level hits; everything else (channels,
/// emails) takes the 1:1 conversion.
fn expand_hit_into_search_hits(hit: Hit<UnifiedSearchIndex>) -> Vec<SearchHit> {
    match &hit.source {
        UnifiedSearchIndex::Document(parent) => {
            let entity_id = parent.entity_id;
            let updated_at = parent
                .updated_at_seconds
                .and_then(|s| DateTime::from_timestamp(s, 0));

            let mut out: Vec<SearchHit> = Vec::new();

            // A name match surfaces as a parent-level hit. The content branch
            // lives in inner_hits and never highlights `document_name`, so a
            // top-level highlight on that field means the name matched. `goto`
            // is None (no chunk to navigate to) so downstream grouping treats
            // it as a name match, not an empty content result.
            if let Some(highlight) = hit.highlight.as_ref()
                && highlight.contains_key(DocumentSearchConfig::TITLE_KEY)
            {
                out.push(SearchHit {
                    entity_id,
                    entity_type: SearchEntityType::Documents,
                    score: hit.score,
                    highlight: parse_highlight_hit(
                        highlight.clone(),
                        Keys {
                            title_key: DocumentSearchConfig::TITLE_KEY,
                            content_key: DocumentSearchConfig::CONTENT_KEY,
                        },
                    ),
                    goto: None,
                    updated_at,
                });
            }

            // Content matches surface as one hit per matching chunk.
            if let Some(inner) = hit.inner_hits.as_ref() {
                out.extend(crate::search::documents::expand_inner_hits_to_search_hits(
                    entity_id, updated_at, inner,
                ));
            }

            if out.is_empty() {
                return vec![hit.into()];
            }
            out
        }
        UnifiedSearchIndex::Chat(parent) => {
            let Some(inner) = hit.inner_hits.as_ref() else {
                return vec![hit.into()];
            };
            let entity_id = parent.entity_id;
            let updated_at = parent
                .updated_at_seconds
                .and_then(|s| DateTime::from_timestamp(s, 0));
            let expanded = crate::search::chats::expand_inner_hits_to_search_hits(
                entity_id, updated_at, inner,
            );
            if expanded.is_empty() {
                return vec![hit.into()];
            }
            expanded
        }
        UnifiedSearchIndex::CallRecord(parent) => {
            let Some(inner) = hit.inner_hits.as_ref() else {
                return vec![hit.into()];
            };
            let expanded =
                crate::search::call_records::expand_inner_hits_to_search_hits(parent, inner);
            if expanded.is_empty() {
                return vec![hit.into()];
            }
            expanded
        }
        _ => vec![hit.into()],
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
                goto: None,
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
                goto: None,
                updated_at: a
                    .updated_at_seconds
                    .and_then(|s| DateTime::from_timestamp(s, 0)),
            },
            UnifiedSearchIndex::Project(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: SearchEntityType::Projects,
                score: index.score,
                highlight: index
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
                goto: None,
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
                    // Reached only on the defensive parent fallback when a
                    // matched parent carried no inner_hits. transcript_id,
                    // speaker_id, and sequence_num are child-only fields, so
                    // there is no segment-level identifier to navigate to here.
                    transcript_id: uuid::Uuid::nil(),
                    speaker_id: String::new(),
                    sequence_num: 0,
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

    if args
        .search_indices
        .contains(&OpenSearchEntityType::Projects)
    {
        let project_search_args: ProjectSearchArgs = args.clone().into();
        let project_query_builder: ProjectQueryBuilder = project_search_args.into();
        let project_bool_query = project_query_builder.build_bool_query()?;
        let query_type: QueryType = project_bool_query.build().into();
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
        .field("document_name", em_field().number_of_fragments(0))
        .field("name", em_field().number_of_fragments(0))
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

/// Trim a page of top-level OpenSearch hits and derive the next cursor.
///
/// The query fetches `page_size + 1` *top-level* hits — one per parent entity
/// for the join-shape indices (documents, chats, call records), one per message
/// for the flat indices. Pagination is measured in those top-level hits, never
/// in the child inner-hits a single parent expands into: a document matched on
/// many content chunks is still one entity against the page budget. Counting the
/// expanded children instead lets a couple of chunk-heavy documents exhaust the
/// budget and short the page while minting a spurious "more results" cursor.
///
/// The extra (`page_size + 1`th) hit only signals "more exist"; it is dropped
/// before expansion. The cursor anchors on the last *included* entity — every
/// child a parent expands into carries that parent's `entity_id`/`updated_at`,
/// so the last expanded hit yields the correct `search_after` for the next page.
fn paginate_unified_hits(
    hits: Vec<Hit<UnifiedSearchIndex>>,
    page_size: usize,
) -> (Vec<SearchHit>, SearchCursorOption) {
    let has_more = hits.len() > page_size;

    let results: Vec<SearchHit> = hits
        .into_iter()
        .take(page_size)
        .flat_map(expand_hit_into_search_hits)
        .collect();

    // Continue only with a real anchor to resume from. A page_size of 0 yields
    // an empty page (nothing to anchor on), so emitting NotDone there would loop
    // the caller on identical empty pages. Return a terminal cursor instead.
    let cursor = match results.last() {
        Some(last) if has_more && page_size > 0 => {
            SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
                entity_id: last.entity_id,
                updated_at: last.updated_at.unwrap_or_else(Utc::now),
            }))
        }
        _ => SearchCursorOption::Done,
    };

    (results, cursor)
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

    let (results, cursor) = paginate_unified_hits(result.hits.hits, args.page_size as usize);

    Ok((results, cursor))
}

#[cfg(test)]
mod test;
