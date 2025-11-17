use crate::{
    CHANNEL_INDEX, CHAT_INDEX, DOCUMENTS_INDEX, EMAIL_INDEX, PROJECT_INDEX, Result,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::SearchQueryConfig,
        channels::{ChannelMessageIndex, ChannelMessageSearchConfig, ChannelMessageSearchResponse},
        chats::{ChatIndex, ChatSearchConfig, ChatSearchResponse},
        documents::{DocumentIndex, DocumentSearchConfig, DocumentSearchResponse},
        emails::{EmailIndex, EmailSearchConfig, EmailSearchResponse},
        model::{DefaultSearchResponse, Hit, parse_highlight_hit},
        projects::{ProjectIndex, ProjectSearchConfig, ProjectSearchResponse},
        query::{Keys, QueryKey, generate_name_content_unified_query, generate_terms_must_query},
        utils::should_wildcard_field_query_builder,
    },
};

use crate::SearchOn;
use opensearch_query_builder::*;

#[derive(Debug, Default)]
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
    pub document_search_args: DocumentSearchArgs,
    pub email_search_args: EmailSearchArgs,
    pub channel_message_search_args: ChannelMessageSearchArgs,
    pub chat_search_args: ChatSearchArgs,
    pub project_search_args: ProjectSearchArgs,
}

#[derive(Debug, Default)]
pub struct ChatSearchArgs {
    pub chat_ids: Vec<String>,
    pub role: Vec<String>,
}

#[derive(Debug, Default)]
pub struct DocumentSearchArgs {
    pub document_ids: Vec<String>,
}

#[derive(Debug, Default)]
pub struct EmailSearchArgs {
    pub thread_ids: Vec<String>,
    pub link_ids: Vec<String>,
    pub sender: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub recipients: Vec<String>,
}

#[derive(Debug, Default)]
pub struct ProjectSearchArgs {
    pub project_ids: Vec<String>,
}

#[derive(Debug, Default)]
pub struct ChannelMessageSearchArgs {
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
pub struct UnifiedSearchKeys<'a> {
    pub document: Keys<'a>,
    pub email: Keys<'a>,
    pub channel_message: Keys<'a>,
    pub chat: Keys<'a>,
    pub project: Keys<'a>,
}

#[tracing::instrument(skip(client, args), err)]
pub(crate) async fn search_unified(
    client: &opensearch::OpenSearch,
    args: UnifiedSearchArgs,
) -> Result<Vec<UnifiedSearchResponse>> {
    let keys = UnifiedSearchKeys {
        document: Keys {
            title_key: DocumentSearchConfig::TITLE_KEY,
            content_key: DocumentSearchConfig::CONTENT_KEY,
        },
        email: Keys {
            title_key: EmailSearchConfig::TITLE_KEY,
            content_key: EmailSearchConfig::CONTENT_KEY,
        },
        channel_message: Keys {
            title_key: ChannelMessageSearchConfig::TITLE_KEY,
            content_key: ChannelMessageSearchConfig::CONTENT_KEY,
        },
        chat: Keys {
            title_key: ChatSearchConfig::TITLE_KEY,
            content_key: ChatSearchConfig::CONTENT_KEY,
        },
        project: Keys {
            title_key: ProjectSearchConfig::TITLE_KEY,
            content_key: ProjectSearchConfig::CONTENT_KEY,
        },
    };

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

    let mut bool_query = BoolQueryBuilder::new();
    // Currently, the minimum should match is always one.
    // This should of the bool query contains the ids and potentially the user_id
    bool_query.minimum_should_match(1);

    if args.terms.is_empty() {
        return Err(OpensearchClientError::NoTermsProvided);
    }

    let query_key = QueryKey::from_match_type(&args.match_type)?;

    let mut must_array = Vec::new();

    match args.search_on {
        SearchOn::Name => {
            // map all terms over title key
            must_array.push(generate_terms_must_query(
                query_key,
                &[
                    keys.document.title_key,
                    keys.email.title_key,
                    keys.channel_message.title_key,
                    keys.chat.title_key,
                    keys.project.title_key,
                ],
                &args.terms,
            ));
        }
        SearchOn::Content => {
            // map all terms over content key
            must_array.push(generate_terms_must_query(
                query_key,
                &["content"],
                &args.terms,
            ));
        }
        SearchOn::NameContent => {
            must_array.push(generate_name_content_unified_query(
                &[
                    keys.document.title_key,
                    keys.email.title_key,
                    keys.channel_message.title_key,
                    keys.chat.title_key,
                    keys.project.title_key,
                ],
                &args.terms,
            ));
        }
    };

    tracing::trace!("term_must_array: {:?}", must_array);

    // For each item in term must array, add to bool must query
    for must in must_array {
        bool_query.must(must);
    }

    // Create master list of ids to search over
    let mut ids = args.document_search_args.document_ids.clone();
    ids.extend(args.email_search_args.thread_ids.clone());
    ids.extend(args.channel_message_search_args.channel_ids.clone());
    ids.extend(args.chat_search_args.chat_ids.clone());
    ids.extend(args.project_search_args.project_ids.clone());

    if !ids.is_empty() {
        bool_query.should(QueryType::terms("entity_id", ids));
    }

    // If we are not searching over the ids, we need to add the user_id to the should array
    if !args.ids_only {
        // document specific
        bool_query.should(QueryType::term("owner_id", args.user_id.clone()));
        // everything else
        bool_query.should(QueryType::term("user_id", args.user_id.clone()));
    }

    // CUSTOM ATTRIBUTES SECTION

    // Add channel_thread_ids to must clause if provided
    let mut channel_args_query = BoolQueryBuilder::new();
    let mut should_add_channel_query = false;
    channel_args_query.minimum_should_match(1);

    channel_args_query.must(QueryType::term("_index", CHANNEL_INDEX));

    if !args.channel_message_search_args.thread_ids.is_empty() {
        should_add_channel_query = true;
        channel_args_query.must(QueryType::terms(
            "thread_id",
            args.channel_message_search_args.thread_ids,
        ));
    }

    if !args.channel_message_search_args.mentions.is_empty() {
        should_add_channel_query = true;
        channel_args_query.must(QueryType::terms(
            "mentions",
            args.channel_message_search_args.mentions,
        ));
    }

    if !args.channel_message_search_args.sender_ids.is_empty() {
        should_add_channel_query = true;
        channel_args_query.must(QueryType::terms(
            "sender_id",
            args.channel_message_search_args.sender_ids,
        ));
    }

    let mut chat_args_query = BoolQueryBuilder::new();
    let mut should_add_chat_query = false;
    chat_args_query.minimum_should_match(1);

    chat_args_query.must(QueryType::term("_index", CHAT_INDEX));

    if !args.chat_search_args.role.is_empty() {
        should_add_chat_query = true;
        let should_query = should_wildcard_field_query_builder("role", &args.chat_search_args.role);
        chat_args_query.must(should_query);
    }

    let mut emails_args_query = BoolQueryBuilder::new();
    let mut should_add_emails_query = false;
    emails_args_query.minimum_should_match(1);
    emails_args_query.must(QueryType::term("_index", EMAIL_INDEX));

    if !args.email_search_args.link_ids.is_empty() {
        should_add_emails_query = true;
        emails_args_query.must(QueryType::terms("link_id", args.email_search_args.link_ids));
    }

    if !args.email_search_args.sender.is_empty() {
        should_add_emails_query = true;
        let senders_query =
            should_wildcard_field_query_builder("sender", &args.email_search_args.sender);
        emails_args_query.must(senders_query);
    }

    if !args.email_search_args.cc.is_empty() {
        should_add_emails_query = true;
        let ccs_query = should_wildcard_field_query_builder("cc", &args.email_search_args.cc);
        emails_args_query.must(ccs_query);
    }
    if !args.email_search_args.bcc.is_empty() {
        should_add_emails_query = true;
        let bccs_query = should_wildcard_field_query_builder("bcc", &args.email_search_args.bcc);
        emails_args_query.must(bccs_query);
    }
    if !args.email_search_args.recipients.is_empty() {
        should_add_emails_query = true;
        let recipients_query =
            should_wildcard_field_query_builder("recipients", &args.email_search_args.recipients);
        emails_args_query.must(recipients_query);
    }

    // END CUSTOM ATTRIBUTES SECTION

    if should_add_channel_query {
        bool_query.must(channel_args_query.build().into());
    }

    if should_add_chat_query {
        bool_query.must(chat_args_query.build().into());
    }

    if should_add_emails_query {
        bool_query.must(emails_args_query.build().into());
    }

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

    let search_request = search_request_builder.build().to_json();

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
