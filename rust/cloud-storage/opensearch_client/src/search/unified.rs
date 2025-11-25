use std::collections::HashSet;

use crate::{
    Result,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::SearchQueryConfig,
        channels::{
            ChannelMessageIndex, ChannelMessageQueryBuilder, ChannelMessageSearchArgs,
            ChannelMessageSearchConfig, ChannelMessageSearchContentResponse,
        },
        chats::{
            ChatIndex, ChatQueryBuilder, ChatSearchArgs, ChatSearchConfig,
            ChatSearchContentResponse,
        },
        documents::{
            DocumentIndex, DocumentQueryBuilder, DocumentSearchArgs, DocumentSearchConfig,
            DocumentSearchContentResponse,
        },
        emails::{
            EmailIndex, EmailQueryBuilder, EmailSearchArgs, EmailSearchConfig, EmailSearchResponse,
        },
        model::{
            DefaultSearchResponse, Hit, MacroEm, NameIndex, NameSearchResponse, parse_highlight_hit,
        },
        projects::{
            ProjectIndex, ProjectQueryBuilder, ProjectSearchArgs, ProjectSearchConfig,
            ProjectSearchResponse,
        },
        query::Keys,
    },
};

use crate::SearchOn;
use models_opensearch::SearchEntityType;
use opensearch_query_builder::*;

#[derive(Debug, Default, Clone)]
pub struct UnifiedSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub disable_recency: bool,
    /// The indices to search over
    pub search_indices: HashSet<SearchEntityType>,
    /// The document search args
    pub document_search_args: UnifiedDocumentSearchArgs,
    /// The email search args. If None, we do not search emails
    pub email_search_args: UnifiedEmailSearchArgs,
    /// The channel message search args. If None, we do not search channel messages
    pub channel_message_search_args: UnifiedChannelMessageSearchArgs,
    /// The chat search args. If None, we do not search chats
    pub chat_search_args: UnifiedChatSearchArgs,
    /// The project search args. If None, we do not search projects
    pub project_search_args: UnifiedProjectSearchArgs,
}

impl From<UnifiedSearchArgs> for DocumentSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        DocumentSearchArgs {
            terms: args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            search_on: args.search_on,
            collapse: args.collapse,
            disable_recency: args.disable_recency,
            ids_only: args.document_search_args.ids_only,
            document_ids: args.document_search_args.document_ids,
        }
    }
}

impl From<UnifiedSearchArgs> for EmailSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        EmailSearchArgs {
            terms: args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            search_on: args.search_on,
            collapse: args.collapse,
            ids_only: false, // Email is never ids only at the moment
            disable_recency: args.disable_recency,
            thread_ids: args.email_search_args.thread_ids,
            link_ids: args.email_search_args.link_ids,
            sender: args.email_search_args.sender,
            cc: args.email_search_args.cc,
            bcc: args.email_search_args.bcc,
            recipients: args.email_search_args.recipients,
        }
    }
}

impl From<UnifiedSearchArgs> for ChannelMessageSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        ChannelMessageSearchArgs {
            terms: args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            search_on: args.search_on,
            collapse: args.collapse,
            ids_only: true, // channel messages are always ids only
            disable_recency: args.disable_recency,
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
            terms: args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            search_on: args.search_on,
            collapse: args.collapse,
            disable_recency: args.disable_recency,
            ids_only: args.chat_search_args.ids_only,
            chat_ids: args.chat_search_args.chat_ids,
            role: args.chat_search_args.role,
        }
    }
}

impl From<UnifiedSearchArgs> for ProjectSearchArgs {
    fn from(args: UnifiedSearchArgs) -> Self {
        ProjectSearchArgs {
            terms: args.terms,
            user_id: args.user_id,
            page: args.page,
            page_size: args.page_size,
            match_type: args.match_type,
            search_on: args.search_on,
            collapse: args.collapse,
            disable_recency: args.disable_recency,
            ids_only: args.project_search_args.ids_only,
            project_ids: args.project_search_args.project_ids,
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedChatSearchArgs {
    pub chat_ids: Vec<String>,
    pub role: Vec<String>,
    pub ids_only: bool,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedDocumentSearchArgs {
    pub document_ids: Vec<String>,
    pub ids_only: bool,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedEmailSearchArgs {
    pub thread_ids: Vec<String>,
    pub link_ids: Vec<String>,
    pub sender: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub recipients: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedProjectSearchArgs {
    pub project_ids: Vec<String>,
    pub ids_only: bool,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedChannelMessageSearchArgs {
    pub channel_ids: Vec<String>,
    pub thread_ids: Vec<String>,
    pub mentions: Vec<String>,
    pub sender_ids: Vec<String>,
}

/// Possible search result indices for unified search
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub(crate) enum UnifiedSearchIndex {
    ChannelMessage(ChannelMessageIndex),
    Document(DocumentIndex),
    Chat(ChatIndex),
    Email(EmailIndex),
    Project(ProjectIndex),
    Name(NameIndex),
}

#[derive(Debug)]
pub enum UnifiedSearchResponse {
    ChannelMessage(ChannelMessageSearchContentResponse),
    Chat(ChatSearchContentResponse),
    Document(DocumentSearchContentResponse),
    Name(NameSearchResponse),
    Email(EmailSearchResponse),
    Project(ProjectSearchResponse),
}

pub struct SplitUnifiedSearchResponseValues {
    pub channel_message: Vec<ChannelMessageSearchContentResponse>,
    pub chat: Vec<ChatSearchContentResponse>,
    pub document: Vec<DocumentSearchContentResponse>,
    pub email: Vec<EmailSearchResponse>,
    pub project: Vec<ProjectSearchResponse>,
    pub name: Vec<NameSearchResponse>,
}

pub trait SplitUnifiedSearchResponse: Iterator<Item = UnifiedSearchResponse> {
    fn split_search_response(self) -> SplitUnifiedSearchResponseValues;
}

impl<T> SplitUnifiedSearchResponse for T
where
    T: Iterator<Item = UnifiedSearchResponse>,
{
    fn split_search_response(self) -> SplitUnifiedSearchResponseValues {
        let (channel_message, chat, document, email, project, name) = self.into_iter().fold(
            (vec![], vec![], vec![], vec![], vec![], vec![]),
            |(mut channel_message, mut chat, mut document, mut email, mut project, mut name),
             item| {
                match item {
                    UnifiedSearchResponse::ChannelMessage(a) => {
                        channel_message.push(a);
                    }
                    UnifiedSearchResponse::Chat(a) => {
                        chat.push(a);
                    }
                    UnifiedSearchResponse::Document(a) => {
                        document.push(a);
                    }
                    UnifiedSearchResponse::Email(a) => {
                        email.push(a);
                    }
                    UnifiedSearchResponse::Project(a) => {
                        project.push(a);
                    }
                    UnifiedSearchResponse::Name(a) => {
                        name.push(a);
                    }
                }
                (channel_message, chat, document, email, project, name)
            },
        );

        SplitUnifiedSearchResponseValues {
            channel_message,
            chat,
            document,
            email,
            project,
            name,
        }
    }
}

impl From<Hit<UnifiedSearchIndex>> for UnifiedSearchResponse {
    fn from(index: Hit<UnifiedSearchIndex>) -> Self {
        match index.source {
            UnifiedSearchIndex::ChannelMessage(a) => {
                UnifiedSearchResponse::ChannelMessage(ChannelMessageSearchContentResponse {
                    channel_id: a.entity_id,
                    channel_type: a.channel_type,
                    org_id: a.org_id,
                    message_id: a.message_id,
                    thread_id: a.thread_id,
                    sender_id: a.sender_id,
                    mentions: a.mentions,
                    created_at: a.created_at_seconds,
                    updated_at: a.updated_at_seconds,
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
                })
            }
            UnifiedSearchIndex::Document(a) => {
                UnifiedSearchResponse::Document(DocumentSearchContentResponse {
                    document_id: a.entity_id,
                    document_name: a.document_name,
                    node_id: a.node_id,
                    raw_content: a.raw_content,
                    owner_id: a.owner_id,
                    file_type: a.file_type,
                    updated_at: a.updated_at_seconds,
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
                })
            }
            UnifiedSearchIndex::Email(a) => UnifiedSearchResponse::Email(EmailSearchResponse {
                thread_id: a.entity_id,
                message_id: a.message_id,
                subject: a.subject,
                sender: a.sender,
                recipients: a.recipients,
                cc: a.cc,
                bcc: a.bcc,
                labels: a.labels,
                link_id: a.link_id,
                user_id: a.user_id,
                updated_at: a.updated_at_seconds,
                sent_at: a.sent_at_seconds,
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
            }),
            UnifiedSearchIndex::Project(a) => {
                UnifiedSearchResponse::Project(ProjectSearchResponse {
                    project_id: a.entity_id,
                    user_id: a.user_id,
                    project_name: a.project_name,
                    created_at: a.created_at_seconds,
                    updated_at: a.updated_at_seconds,
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
                })
            }
            UnifiedSearchIndex::Chat(a) => UnifiedSearchResponse::Chat(ChatSearchContentResponse {
                chat_id: a.entity_id,
                chat_message_id: a.chat_message_id,
                user_id: a.user_id,
                role: a.role,
                title: a.title,
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
                updated_at: a.updated_at_seconds,
            }),
            UnifiedSearchIndex::Name(a) => UnifiedSearchResponse::Name(NameSearchResponse {
                entity_id: a.entity_id,
                entity_type: a.entity_type,
                name: a.name,
                user_id: a.user_id,
                score: index.score,
                highlight: index
                    .highlight
                    .map(|h| {
                        parse_highlight_hit(
                            h,
                            Keys {
                                title_key: "name",
                                content_key: "",
                            },
                        )
                    })
                    .unwrap_or_default(),
            }),
        }
    }
}

#[tracing::instrument(skip(args), err)]
fn build_unified_search_request(args: &UnifiedSearchArgs) -> Result<SearchRequest<'static>> {
    if args.search_indices.is_empty() {
        return Err(OpensearchClientError::EmptySearchIndices);
    }
    // Build out the title keys that we could need for highlighting
    let mut title_keys: HashSet<&'static str> = HashSet::new();
    for index in &args.search_indices {
        match index {
            SearchEntityType::Channels => title_keys.insert(ChannelMessageSearchConfig::TITLE_KEY),
            SearchEntityType::Chats => title_keys.insert(ChatSearchConfig::TITLE_KEY),
            SearchEntityType::Documents => title_keys.insert(DocumentSearchConfig::TITLE_KEY),
            SearchEntityType::Emails => title_keys.insert(EmailSearchConfig::TITLE_KEY),
            SearchEntityType::Projects => title_keys.insert(ProjectSearchConfig::TITLE_KEY),
        };
    }

    let title_keys: Vec<&'static str> = title_keys.into_iter().collect();

    let mut bool_query = BoolQueryBuilder::new();
    bool_query.minimum_should_match(1);

    if args.search_indices.contains(&SearchEntityType::Documents) {
        let document_search_args: DocumentSearchArgs = args.clone().into();
        let document_query_builder: DocumentQueryBuilder = document_search_args.into();
        let document_bool_query = document_query_builder.build_bool_query()?;
        let query_type: QueryType = document_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    if args.search_indices.contains(&SearchEntityType::Emails) {
        let email_search_args: EmailSearchArgs = args.clone().into();
        let email_query_builder: EmailQueryBuilder = email_search_args.into();
        let email_bool_query = email_query_builder.build_bool_query()?;
        let query_type: QueryType = email_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    // We can only search over channels if we are not explicitly searching by name
    if args.search_indices.contains(&SearchEntityType::Channels) && args.search_on != SearchOn::Name
    {
        let channel_message_search_args: ChannelMessageSearchArgs = args.clone().into();
        let channel_message_query_builder: ChannelMessageQueryBuilder =
            channel_message_search_args.into();
        let channel_message_bool_query = channel_message_query_builder.build_bool_query()?;
        let query_type: QueryType = channel_message_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    if args.search_indices.contains(&SearchEntityType::Chats) {
        let chat_search_args: ChatSearchArgs = args.clone().into();
        let chat_query_builder: ChatQueryBuilder = chat_search_args.into();
        let chat_bool_query = chat_query_builder.build_bool_query()?;
        let query_type: QueryType = chat_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    if args.search_indices.contains(&SearchEntityType::Projects)
        && args.search_on != SearchOn::Content
    {
        let project_search_args: ProjectSearchArgs = args.clone().into();
        let project_query_builder: ProjectQueryBuilder = project_search_args.into();
        let project_bool_query = project_query_builder.build_bool_query()?;
        let query_type: QueryType = project_bool_query.build().into();
        bool_query.should(query_type.to_owned());
    }

    // create the search request
    let mut search_request_builder = SearchRequestBuilder::new();

    search_request_builder.from(args.page * args.page_size);
    search_request_builder.size(args.page_size);

    if args.collapse {
        search_request_builder.collapse(Collapse::new("entity_id"));
    }

    // Build sort
    let sort = vec![
        SortType::ScoreWithOrder(ScoreWithOrderSort::new(SortOrder::Desc)),
        SortType::Field(FieldSort::new("entity_id", SortOrder::Desc)),
    ];

    for sort in sort {
        search_request_builder.add_sort(sort);
    }

    // Build highlight
    let highlight = match args.search_on {
        SearchOn::Content => Highlight::new().require_field_match(true).field(
            "content",
            HighlightField::new()
                .highlight_type("plain")
                .pre_tags(vec![MacroEm::Open.to_string()])
                .post_tags(vec![MacroEm::Close.to_string()])
                .number_of_fragments(500),
        ),
        SearchOn::Name => {
            let mut highlight = Highlight::new();

            highlight = highlight.require_field_match(true);

            for field in title_keys {
                highlight = highlight.field(
                    field,
                    HighlightField::new()
                        .highlight_type("plain")
                        .pre_tags(vec![MacroEm::Open.to_string()])
                        .post_tags(vec![MacroEm::Close.to_string()])
                        .number_of_fragments(1),
                );
            }
            highlight
        }
        SearchOn::NameContent => {
            let mut highlight = Highlight::new();

            highlight = highlight.require_field_match(false);

            for field in title_keys {
                highlight = highlight.field(
                    field,
                    HighlightField::new()
                        .highlight_type("plain")
                        .pre_tags(vec![MacroEm::Open.to_string()])
                        .post_tags(vec![MacroEm::Close.to_string()])
                        .number_of_fragments(1),
                );
            }

            highlight = highlight.field(
                "content",
                HighlightField::new()
                    .highlight_type("plain")
                    .pre_tags(vec![MacroEm::Open.to_string()])
                    .post_tags(vec![MacroEm::Close.to_string()])
                    .number_of_fragments(1),
            );

            highlight
        }
    };

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
) -> Result<Vec<UnifiedSearchResponse>> {
    let search_request = build_unified_search_request(&args)?.to_json();

    let search_indices: Vec<&str> = args.search_indices.iter().map(|i| i.as_ref()).collect();

    let response = client
        .search(opensearch::SearchParts::Index(&search_indices))
        .body(search_request)
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

    let result: DefaultSearchResponse<UnifiedSearchIndex> = serde_json::from_slice(&bytes)
        .map_err(|e| OpensearchClientError::SearchDeserializationFailed {
            details: e.to_string(),
            raw_body: String::from_utf8_lossy(&bytes).to_string(),
        })?;

    Ok(result.hits.hits.into_iter().map(|h| h.into()).collect())
}

#[cfg(test)]
mod test;
