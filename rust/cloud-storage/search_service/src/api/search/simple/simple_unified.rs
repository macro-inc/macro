use crate::api::search::simple::filter::FilterVariantToSearchArgs;
use crate::api::search::simple::filter::UnifiedSearchArgsVariant;

use crate::api::search::simple::{simple_chat, simple_document, simple_email, simple_project};
use crate::api::{
    ApiContext,
    search::{SearchPaginationParams, simple::SearchError},
};
use axum::{
    Extension,
    extract::{self, State},
    response::Json,
};
use macro_user_id::user_id::MacroUserId;
use model::{response::ErrorResponse, user::UserContext};
use models_search::unified::generate_unified_search_indices;
use models_search::{
    SearchOn, SimpleSearchResponse,
    unified::{SimpleUnifiedSearchResponse, UnifiedSearchIndex, UnifiedSearchRequest},
};
use models_search_cursor::SearchCursor;
use opensearch_client::search::unified::UnifiedSearchArgs;

/// Creates a unified search request and performs the search
/// by calling individual simple search endpoints for each entity type
#[tracing::instrument(skip(ctx, user_context, query_params, req), err)]
pub(in crate::api::search) async fn perform_unified_search(
    ctx: &ApiContext,
    user_context: &UserContext,
    query_params: SearchPaginationParams,
    req: UnifiedSearchRequest,
) -> Result<(Vec<opensearch_client::search::model::SearchHit>, Option<String>), SearchError> {
    let user_id = user_context.user_id.clone();

    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }
    let user_id = MacroUserId::parse_from_str(&user_id)
        .map_err(|_| SearchError::InvalidUserId(user_id.to_string()))?
        .lowercase();

    let search_on = req.search_on;
    let user_organization_id = user_context.organization_id;
    let collapse = req.collapse.unwrap_or(false);

    // Parse cursor from query params
    let cursor: Option<SearchCursor> = query_params
        .cursor
        .as_ref()
        .and_then(|c| SearchCursor::decode(c));

    let page_size = query_params.page_size.unwrap_or(10);
    if !(0..=100).contains(&page_size) {
        return Err(SearchError::InvalidPageSize);
    }

    let terms: Vec<String> = match (req.terms.clone(), req.query.clone()) {
        (Some(terms), _) => terms.into_iter().filter(|t| t.len() >= 3).collect(),
        (None, Some(query)) if query.len() >= 3 => vec![query],
        (None, Some(_)) => {
            return Err(SearchError::InvalidQuerySize);
        }
        _ => vec![],
    };

    if terms.is_empty() {
        return Err(SearchError::NoQueryOrTermsProvided);
    }

    let match_type = req.match_type;
    let disable_recency = req.disable_recency;
    let include = req.include;

    let filters = req.filters.unwrap_or_default();
    let channel_filters = filters.channel.unwrap_or_default();
    let email_filters = filters.email.unwrap_or_default();
    let chat_filters = filters.chat.unwrap_or_default();
    let doc_filters = filters.document.unwrap_or_default();
    let project_filters = filters.project.unwrap_or_default();

    let should_include_documents =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Documents);
    let should_include_channels =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Channels);
    let should_include_chats = include.is_empty() || include.contains(&UnifiedSearchIndex::Chats);
    let should_include_projects =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Projects);
    let should_include_emails = include.is_empty() || include.contains(&UnifiedSearchIndex::Emails);

    // Await all tasks in parallel
    let (doc_result, channel_result, chat_result, email_result, project_result) = tokio::try_join!(
        doc_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_documents,
        ),
        channel_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_channels,
        ),
        chat_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_chats,
        ),
        email_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_emails,
        ),
        project_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_projects
        )
    )
    .map_err(|e| SearchError::InternalError(anyhow::anyhow!("tokio error: {:?}", e)))?;

    let filter_document_response = match doc_result {
        UnifiedSearchArgsVariant::Document(response) => response,
        _ => unreachable!(),
    };

    let filter_channel_response = match channel_result {
        UnifiedSearchArgsVariant::Channel(response) => response,
        _ => unreachable!(),
    };

    let filter_chat_response = match chat_result {
        UnifiedSearchArgsVariant::Chat(response) => response,
        _ => unreachable!(),
    };

    let filter_email_response = match email_result {
        UnifiedSearchArgsVariant::Email(response) => response,
        _ => unreachable!(),
    };

    let filter_project_response = match project_result {
        UnifiedSearchArgsVariant::Project(response) => response,
        _ => unreachable!(),
    };

    // Clone terms for use in name searches
    let name_search_term = terms[0].clone();

    // Extract individual cursors from the combined cursor
    let document_cursor = cursor.as_ref().and_then(|c| c.document_name_cursor.clone());
    let chat_cursor = cursor.as_ref().and_then(|c| c.chat_name_cursor.clone());
    let email_cursor = cursor.as_ref().and_then(|c| c.email_subject_cursor.clone());
    let project_cursor = cursor.as_ref().and_then(|c| c.project_name_cursor.clone());

    let unified_search_args = UnifiedSearchArgs {
        terms,
        user_id: user_id.as_ref().to_string(),
        page: 0, // With cursor-based pagination, we always start from "page 0" relative to cursor
        page_size,
        match_type: match_type.to_string(),
        search_on: search_on.into(),
        collapse,
        disable_recency,
        search_indices: generate_unified_search_indices(include),
        document_search_args: filter_document_response.clone(),
        email_search_args: filter_email_response.clone(),
        channel_message_search_args: filter_channel_response,
        chat_search_args: filter_chat_response.clone(),
    };

    // Call search functions in parallel for included entity types
    let (doc_name_results, chat_results, email_results, project_results, content_results) = tokio::join!(
        async {
            if should_include_documents {
                match search_on {
                    SearchOn::Name | SearchOn::NameContent => {
                        simple_document::search_names(
                            &ctx.db,
                            &user_id,
                            &simple_document::FilterDocumentResponse {
                                ids_only: filter_document_response.ids_only,
                                document_ids: filter_document_response.document_ids,
                            },
                            name_search_term.clone(),
                            page_size,
                            document_cursor,
                        )
                        .await
                    }
                    SearchOn::Content => Ok((vec![], None)),
                }
            } else {
                Ok((vec![], None))
            }
        },
        async {
            if should_include_chats {
                match search_on {
                    SearchOn::Name | SearchOn::NameContent => {
                        simple_chat::search_names(
                            &ctx.db,
                            &user_id,
                            &simple_chat::FilterChatResponse {
                                ids_only: filter_chat_response.ids_only,
                                chat_ids: filter_chat_response.chat_ids,
                            },
                            name_search_term.clone(),
                            page_size,
                            chat_cursor,
                        )
                        .await
                    }
                    SearchOn::Content => Ok((vec![], None)),
                }
            } else {
                Ok((vec![], None))
            }
        },
        async {
            if should_include_emails {
                match search_on {
                    SearchOn::Name | SearchOn::NameContent => {
                        simple_email::search_names(
                            &ctx.db,
                            &user_id,
                            &simple_email::FilterEmailResponse {
                                ids_only: false,
                                thread_ids: filter_email_response.thread_ids,
                            },
                            name_search_term.clone(),
                            page_size,
                            email_cursor,
                        )
                        .await
                    }
                    SearchOn::Content => Ok((vec![], None)),
                }
            } else {
                Ok((vec![], None))
            }
        },
        async {
            if should_include_projects {
                match search_on {
                    SearchOn::Name | SearchOn::NameContent => {
                        simple_project::search_names(
                            &ctx.db,
                            &user_id,
                            &simple_project::FilterProjectResponse {
                                ids_only: filter_project_response.ids_only,
                                project_ids: filter_project_response.project_ids,
                            },
                            name_search_term.clone(),
                            page_size,
                            project_cursor,
                        )
                        .await
                    }
                    SearchOn::Content => Ok((vec![], None)),
                }
            } else {
                Ok((vec![], None))
            }
        },
        async {
            // We only want to search over content if you are not searching name only
            match search_on {
                SearchOn::Content | SearchOn::NameContent => {
                    ctx.opensearch_client
                        .search_unified(unified_search_args)
                        .await
                }
                SearchOn::Name => Ok(vec![]),
            }
        },
    );

    // Extract results and next cursors
    let (doc_hits, doc_next_cursor) = doc_name_results?;
    let (chat_hits, chat_next_cursor) = chat_results?;
    let (email_hits, email_next_cursor) = email_results?;
    let (project_hits, project_next_cursor) = project_results?;
    let content_hits = content_results?;

    // Combine all results
    let mut combined_results = Vec::new();
    combined_results.extend(doc_hits);
    combined_results.extend(chat_hits);
    combined_results.extend(email_hits);
    combined_results.extend(project_hits);
    combined_results.extend(content_hits);

    // Build next cursor if any search has more results
    let has_more = doc_next_cursor.is_some()
        || chat_next_cursor.is_some()
        || email_next_cursor.is_some()
        || project_next_cursor.is_some();

    let next_cursor = if has_more {
        let cursor = SearchCursor {
            document_name_cursor: doc_next_cursor,
            chat_name_cursor: chat_next_cursor,
            content_cursor: None, // Content search cursor not yet implemented
            email_subject_cursor: email_next_cursor,
            project_name_cursor: project_next_cursor,
        };
        cursor.encode()
    } else {
        None
    };

    Ok((combined_results, next_cursor))
}

/// Perform a search through all items.
/// This is a simple search where we do not group your results by entity id.
#[utoipa::path(
    post,
    path = "/search/simple",
    operation_id = "simple_unified_search",
    params(
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
            ("cursor" = Option<String>, Query, description = "Base64 encoded cursor for pagination."),
    ),
    responses(
            (status = 200, body=SimpleUnifiedSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<UnifiedSearchRequest>,
) -> Result<Json<SimpleSearchResponse>, SearchError> {
    tracing::info!("simple_unified_search");

    let (results, _next_cursor) = perform_unified_search(&ctx, &user_context, query_params, req).await?;

    let results = results.into_iter().map(|a| a.into()).collect();

    // Note: SimpleSearchResponse doesn't have a next_cursor field
    // The cursor is returned by the unified search endpoint (/search)
    Ok(Json(SimpleSearchResponse { results }))
}
