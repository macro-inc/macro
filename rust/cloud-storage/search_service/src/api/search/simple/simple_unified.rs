use crate::api::{
    ApiContext,
    search::{
        SearchPaginationParams,
        simple::{
            SearchError,
            filter::{FilterVariantToSearchArgs, UnifiedSearchArgsVariant},
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
    unified::{
        SimpleUnifiedSearchResponse, UnifiedSearchIndex, UnifiedSearchRequest,
        generate_unified_search_indices,
    },
};
use opensearch_client::search::unified::UnifiedSearchArgs;

/// Creates a unified search request and performs the search
/// Returning the opensearch results
#[tracing::instrument(skip(ctx, user_context, query_params, req), err)]
pub(in crate::api::search) async fn perform_unified_search(
    ctx: &ApiContext,
    user_context: &UserContext,
    query_params: SearchPaginationParams,
    req: UnifiedSearchRequest,
) -> Result<Vec<opensearch_client::search::model::SearchHit>, SearchError> {
    let user_id = &user_context.user_id;
    let user_organization_id = user_context.organization_id;
    let search_on = req.search_on;
    let collapse = req.collapse.unwrap_or(false);

    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }

    let page = query_params.page.unwrap_or(0);

    let page_size = query_params.page_size.unwrap_or(10);
    if !(0..=100).contains(&page_size) {
        return Err(SearchError::InvalidPageSize);
    }

    let terms: Vec<String> = match (req.terms, req.query) {
        (Some(terms), _) => terms.into_iter().filter(|t| t.len() >= 3).collect(),
        (None, Some(query)) if query.len() >= 3 => vec![query],
        (None, Some(_)) => {
            return Err(SearchError::InvalidQuerySize);
        }
        _ => vec![],
    };

    let match_type = req.match_type;
    let disable_recency = req.disable_recency;

    let include = req.include;

    // Create default filters
    let filters = req.filters.unwrap_or_default();
    let channel_filters = filters.channel.unwrap_or_default();
    let email_filters = filters.email.unwrap_or_default();
    let chat_filters = filters.chat.unwrap_or_default();
    let project_filters = filters.project.unwrap_or_default();
    let doc_filters = filters.document.unwrap_or_default();

    let should_include_documents =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Documents);

    let should_include_channels =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Channels);

    let should_include_chats = include.is_empty() || include.contains(&UnifiedSearchIndex::Chats);

    let should_include_projects =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Projects);

    let should_include_emails = include.is_empty() || include.contains(&UnifiedSearchIndex::Emails);

    // Await all tasks in parallel
    let (doc_result, channel_result, chat_result, project_result, email_result) = tokio::try_join!(
        doc_filters.filter_to_search_args(
            ctx,
            user_id,
            user_organization_id,
            should_include_documents,
        ),
        channel_filters.filter_to_search_args(
            ctx,
            user_id,
            user_organization_id,
            should_include_channels,
        ),
        chat_filters.filter_to_search_args(
            ctx,
            user_id,
            user_organization_id,
            should_include_chats,
        ),
        project_filters.filter_to_search_args(
            ctx,
            user_id,
            user_organization_id,
            should_include_projects,
        ),
        email_filters.filter_to_search_args(
            ctx,
            user_id,
            user_organization_id,
            should_include_emails,
        ),
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

    let filter_project_response = match project_result {
        UnifiedSearchArgsVariant::Project(response) => response,
        _ => unreachable!(),
    };

    let filter_email_response = match email_result {
        UnifiedSearchArgsVariant::Email(response) => response,
        _ => unreachable!(),
    };

    let unified_search_args = UnifiedSearchArgs {
        terms,
        user_id: user_id.to_string(),
        page,
        page_size,
        match_type: match_type.to_string(),
        search_on: search_on.into(),
        collapse,
        disable_recency,
        search_indices: generate_unified_search_indices(include),
        document_search_args: filter_document_response,
        email_search_args: filter_email_response,
        channel_message_search_args: filter_channel_response,
        chat_search_args: filter_chat_response,
        project_search_args: filter_project_response,
    };

    let results = ctx
        .opensearch_client
        .search_unified(unified_search_args)
        .await?;

    Ok(results)
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
