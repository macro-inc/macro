use crate::api::{
    ApiContext,
    search::{
        SearchPaginationParams,
        simple::{
            SearchError, simple_channel::search_channels, simple_chat::search_chats,
            simple_document::search_documents, simple_email::search_emails,
            simple_project::search_projects,
        },
    },
};
use axum::{
    Extension,
    extract::{self, State},
    response::Json,
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::{
    SimpleSearchResponse,
    channel::ChannelSearchRequest,
    chat::ChatSearchRequest,
    document::DocumentSearchRequest,
    email::EmailSearchRequest,
    project::ProjectSearchRequest,
    unified::{SimpleUnifiedSearchResponse, UnifiedSearchIndex, UnifiedSearchRequest},
};

/// Creates a unified search request and performs the search
/// by calling individual simple search endpoints for each entity type
#[tracing::instrument(skip(ctx, user_context, query_params, req), err)]
pub(in crate::api::search) async fn perform_unified_search(
    ctx: &ApiContext,
    user_context: &UserContext,
    query_params: SearchPaginationParams,
    req: UnifiedSearchRequest,
) -> Result<Vec<opensearch_client::search::model::SearchHit>, SearchError> {
    let user_id = &user_context.user_id;

    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }

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

    let include = &req.include;
    let filters = req.filters.unwrap_or_default();

    let should_include_documents =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Documents);
    let should_include_channels =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Channels);
    let should_include_chats = include.is_empty() || include.contains(&UnifiedSearchIndex::Chats);
    let should_include_projects =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Projects);
    let should_include_emails = include.is_empty() || include.contains(&UnifiedSearchIndex::Emails);

    // Build individual search requests for each entity type
    let doc_request = DocumentSearchRequest {
        terms: Some(terms.clone()),
        query: req.query.clone(),
        match_type: req.match_type,
        search_on: req.search_on,
        collapse: req.collapse,
        disable_recency: req.disable_recency,
        filters: Some(filters.document.unwrap_or_default()),
    };

    let chat_request = ChatSearchRequest {
        terms: Some(terms.clone()),
        query: req.query.clone(),
        match_type: req.match_type,
        search_on: req.search_on,
        collapse: req.collapse,
        disable_recency: req.disable_recency,
        filters: Some(filters.chat.unwrap_or_default()),
    };

    let email_request = EmailSearchRequest {
        terms: Some(terms.clone()),
        query: req.query.clone(),
        match_type: req.match_type,
        search_on: req.search_on,
        collapse: req.collapse,
        disable_recency: req.disable_recency,
        filters: Some(filters.email.unwrap_or_default()),
    };

    let project_request = ProjectSearchRequest {
        terms: Some(terms.clone()),
        query: req.query.clone(),
        match_type: req.match_type,
        search_on: req.search_on,
        collapse: req.collapse,
        disable_recency: req.disable_recency,
        filters: Some(filters.project.unwrap_or_default()),
    };

    let channel_request = ChannelSearchRequest {
        terms: Some(terms.clone()),
        query: req.query.clone(),
        match_type: req.match_type,
        search_on: req.search_on,
        collapse: req.collapse,
        disable_recency: req.disable_recency,
        filters: Some(filters.channel.unwrap_or_default()),
    };

    // Call search functions in parallel for included entity types
    let (doc_results, chat_results, email_results, project_results, channel_results) = tokio::join!(
        async {
            if should_include_documents {
                search_documents(ctx, user_id, &query_params, doc_request).await
            } else {
                Ok(vec![])
            }
        },
        async {
            if should_include_chats {
                search_chats(ctx, user_id, &query_params, chat_request).await
            } else {
                Ok(vec![])
            }
        },
        async {
            if should_include_emails {
                search_emails(ctx, user_id, &query_params, email_request).await
            } else {
                Ok(vec![])
            }
        },
        async {
            if should_include_projects {
                search_projects(ctx, user_id, &query_params, project_request).await
            } else {
                Ok(vec![])
            }
        },
        async {
            if should_include_channels {
                search_channels(
                    ctx,
                    user_id,
                    user_context.organization_id,
                    &query_params,
                    channel_request,
                )
                .await
            } else {
                Ok(vec![])
            }
        },
    );

    // Combine all results
    let mut combined_results = Vec::new();
    combined_results.extend(doc_results?);
    combined_results.extend(chat_results?);
    combined_results.extend(email_results?);
    combined_results.extend(project_results?);
    combined_results.extend(channel_results?);

    Ok(combined_results)
}

/// Perform a search through all items.
/// This is a simple search where we do not group your results by entity id.
#[utoipa::path(
    post,
    path = "/search/simple",
    operation_id = "simple_unified_search",
    params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
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

    let results = perform_unified_search(&ctx, &user_context, query_params, req).await?;

    let results = results.into_iter().map(|a| a.into()).collect();

    Ok(Json(SimpleSearchResponse { results }))
}
