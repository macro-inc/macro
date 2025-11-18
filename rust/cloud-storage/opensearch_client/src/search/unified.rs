use crate::{
    CHANNEL_INDEX, CHAT_INDEX, DOCUMENTS_INDEX, EMAIL_INDEX, PROJECT_INDEX, Result,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::SearchQueryConfig,
        channels::{
            ChannelMessageIndex, ChannelMessageQueryBuilder, ChannelMessageSearchArgs,
            ChannelMessageSearchConfig, ChannelMessageSearchResponse,
        },
        chats::{
            ChatIndex, ChatQueryBuilder, ChatSearchArgs, ChatSearchConfig, ChatSearchResponse,
        },
        documents::{
            DocumentIndex, DocumentQueryBuilder, DocumentSearchArgs, DocumentSearchConfig,
            DocumentSearchResponse,
        },
        emails::{
            EmailIndex, EmailQueryBuilder, EmailSearchArgs, EmailSearchConfig, EmailSearchResponse,
        },
        model::{DefaultSearchResponse, Hit, MacroEm, parse_highlight_hit},
        projects::{
            ProjectIndex, ProjectQueryBuilder, ProjectSearchArgs, ProjectSearchConfig,
            ProjectSearchResponse,
        },
        query::Keys,
    },
};

use crate::SearchOn;
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
    pub ids_only: bool,
    pub disable_recency: bool,
    pub document_search_args: UnifiedDocumentSearchArgs,
    pub email_search_args: UnifiedEmailSearchArgs,
    pub channel_message_search_args: UnifiedChannelMessageSearchArgs,
    pub chat_search_args: UnifiedChatSearchArgs,
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
            ids_only: args.ids_only,
            disable_recency: args.disable_recency,
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
            ids_only: args.ids_only,
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
            ids_only: args.ids_only,
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
            ids_only: args.ids_only,
            disable_recency: args.disable_recency,
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
            ids_only: args.ids_only,
            disable_recency: args.disable_recency,
            project_ids: args.project_search_args.project_ids,
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedChatSearchArgs {
    pub chat_ids: Vec<String>,
    pub role: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct UnifiedDocumentSearchArgs {
    pub document_ids: Vec<String>,
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
pub(crate) enum UnifiedSearchIndex {
    ChannelMessage(ChannelMessageIndex),
    Document(DocumentIndex),
    Chat(ChatIndex),
    Email(EmailIndex),
    Project(ProjectIndex),
}

#[derive(Debug)]
pub enum UnifiedSearchResponse {
    ChannelMessage(ChannelMessageSearchResponse),
    Chat(ChatSearchResponse),
    Document(DocumentSearchResponse),
    Email(EmailSearchResponse),
    Project(ProjectSearchResponse),
}

impl From<Hit<UnifiedSearchIndex>> for UnifiedSearchResponse {
    fn from(index: Hit<UnifiedSearchIndex>) -> Self {
        match index._source {
            UnifiedSearchIndex::ChannelMessage(a) => {
                UnifiedSearchResponse::ChannelMessage(ChannelMessageSearchResponse {
                    channel_id: a.entity_id,
                    channel_name: a.channel_name,
                    channel_type: a.channel_type,
                    org_id: a.org_id,
                    message_id: a.message_id,
                    thread_id: a.thread_id,
                    sender_id: a.sender_id,
                    mentions: a.mentions,
                    created_at: a.created_at_seconds,
                    updated_at: a.updated_at_seconds,
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
                UnifiedSearchResponse::Document(DocumentSearchResponse {
                    document_id: a.entity_id,
                    document_name: a.document_name,
                    node_id: a.node_id,
                    raw_content: a.raw_content,
                    owner_id: a.owner_id,
                    file_type: a.file_type,
                    updated_at: a.updated_at_seconds,
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
            UnifiedSearchIndex::Chat(a) => UnifiedSearchResponse::Chat(ChatSearchResponse {
                chat_id: a.entity_id,
                chat_message_id: a.chat_message_id,
                user_id: a.user_id,
                role: a.role,
                title: a.title,
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
        }
    }
}

#[tracing::instrument(skip(args), err)]
fn build_unified_search_request(args: UnifiedSearchArgs) -> Result<SearchRequest> {
    let title_keys = [
        ChannelMessageSearchConfig::TITLE_KEY,
        ChatSearchConfig::TITLE_KEY,
        DocumentSearchConfig::TITLE_KEY,
        EmailSearchConfig::TITLE_KEY,
        ProjectSearchConfig::TITLE_KEY,
    ];

    // Create search args for each index
    let document_search_args: DocumentSearchArgs = args.clone().into();
    let email_search_args: EmailSearchArgs = args.clone().into();
    let channel_message_search_args: ChannelMessageSearchArgs = args.clone().into();
    let chat_search_args: ChatSearchArgs = args.clone().into();
    let project_search_args: ProjectSearchArgs = args.clone().into();

    // Create the bool query
    let document_query_builder: DocumentQueryBuilder = document_search_args.into();
    let email_query_builder: EmailQueryBuilder = email_search_args.into();
    let channel_message_query_builder: ChannelMessageQueryBuilder =
        channel_message_search_args.into();
    let chat_query_builder: ChatQueryBuilder = chat_search_args.into();
    let project_query_builder: ProjectQueryBuilder = project_search_args.into();

    let mut document_bool_query = document_query_builder.build_bool_query()?;
    let mut email_bool_query = email_query_builder.build_bool_query()?;
    let mut channel_message_bool_query = channel_message_query_builder.build_bool_query()?;
    let mut chat_bool_query = chat_query_builder.build_bool_query()?;
    let mut project_bool_query = project_query_builder.build_bool_query()?;

    // Add must clauses to each bool query
    document_bool_query.must(QueryType::term("_index", DOCUMENTS_INDEX));
    email_bool_query.must(QueryType::term("_index", EMAIL_INDEX));
    channel_message_bool_query.must(QueryType::term("_index", CHANNEL_INDEX));
    chat_bool_query.must(QueryType::term("_index", CHAT_INDEX));
    project_bool_query.must(QueryType::term("_index", PROJECT_INDEX));

    let mut bool_query = BoolQueryBuilder::new();
    bool_query.minimum_should_match(1);

    bool_query.should(document_bool_query.build().into());
    bool_query.should(email_bool_query.build().into());
    bool_query.should(channel_message_bool_query.build().into());
    bool_query.should(chat_bool_query.build().into());
    bool_query.should(project_bool_query.build().into());

    // create the search request
    let mut search_request_builder = SearchRequestBuilder::new();

    search_request_builder.from(args.page * args.page_size);
    search_request_builder.size(args.page_size);

    if args.collapse || args.search_on == SearchOn::NameContent || args.search_on == SearchOn::Name
    {
        search_request_builder.collapse(Collapse::new("entity_id"));
    }

    if args.search_on == SearchOn::NameContent {
        search_request_builder.track_total_hits(true);
        search_request_builder.add_agg(
            "total_uniques".to_string(),
            AggregationType::Cardinality(CardinalityAggregation::new("entity_id")),
        );
    }

    // Build sort
    let sort = vec![
        SortType::ScoreWithOrder(ScoreWithOrderSort::new(SortOrder::Desc)),
        SortType::Field(FieldSort::new("entity_id", SortOrder::Asc)),
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

    let built_query: QueryType = match args.search_on {
        SearchOn::Name | SearchOn::Content => query_object.into(),
        SearchOn::NameContent => {
            if args.disable_recency {
                query_object.into()
            } else {
                let mut function_score_query = FunctionScoreQueryBuilder::new();

                function_score_query.query(query_object.into());

                function_score_query.function(ScoreFunction {
                    function: ScoreFunctionType::Gauss(DecayFunction {
                        field: "updated_at_seconds".to_string(),
                        origin: Some("now".into()),
                        scale: "21d".to_string(),
                        offset: Some("3d".to_string()),
                        decay: Some(0.5),
                    }),
                    filter: None,
                    weight: Some(1.3),
                });

                function_score_query.boost_mode(BoostMode::Multiply);
                function_score_query.score_mode(ScoreMode::Multiply);

                function_score_query.build().into()
            }
        }
    };

    search_request_builder.query(built_query);

    Ok(search_request_builder.build())
}

#[tracing::instrument(skip(client, args), err)]
pub(crate) async fn search_unified(
    client: &opensearch::OpenSearch,
    args: UnifiedSearchArgs,
) -> Result<Vec<UnifiedSearchResponse>> {
    let search_request = build_unified_search_request(args)?.to_json();

    let response = client
        .search(opensearch::SearchParts::Index(&[
            CHANNEL_INDEX,
            CHAT_INDEX,
            EMAIL_INDEX,
            PROJECT_INDEX,
            DOCUMENTS_INDEX,
        ]))
        .body(search_request)
        .send()
        .await
        .map_client_error()
        .await?;

    let result = response
        .json::<DefaultSearchResponse<UnifiedSearchIndex>>()
        .await
        .map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_unified".to_string()),
        })?;

    println!("{:?}", result);

    Ok(result.hits.hits.into_iter().map(|h| h.into()).collect())
}

#[cfg(test)]
mod test;
