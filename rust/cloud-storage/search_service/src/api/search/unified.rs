use super::SearchPaginationParams;
use crate::api::{
    ApiContext,
    search::{
        channel::search_channels_enriched,
        chat::search_chats_enriched,
        document::search_documents_enriched,
        email::search_emails_enriched,
        project::search_projects_enriched,
        simple::{SearchError, simple_unified::boxed_search_future},
    },
};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use futures::{StreamExt, stream::FuturesUnordered};
use model::{response::ErrorResponse, user::UserContext};
use models_search::{
    channel::ChannelSearchRequest,
    chat::ChatSearchRequest,
    document::DocumentSearchRequest,
    email::EmailSearchRequest,
    project::ProjectSearchRequest,
    unified::{
        UnifiedSearchIndex, UnifiedSearchRequest, UnifiedSearchResponse, UnifiedSearchResponseItem,
    },
};

/// Perform a search through all items
#[utoipa::path(
    post,
    path = "/search",
    operation_id = "unified_search",
    params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
    ),
    responses(
            (status = 200, body=UnifiedSearchResponse),
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
) -> Result<Response, SearchError> {
    tracing::info!("unified_search");

    let user_id = &user_context.user_id;
    let user_organization_id = user_context.organization_id;
    let search_on = req.search_on;
    let collapse = req.collapse.unwrap_or(false);

    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }

    // TODO: deduplicate logic for getting page and page size

    let page = query_params.page.unwrap_or(0);

    let page_size = query_params.page_size.unwrap_or(10);
    if !(0..=100).contains(&page_size) {
        return Err(SearchError::InvalidPageSize);
    }

    // TODO: deduplicate logic for extracting terms
    let terms: Vec<String> = match (req.terms, req.query) {
        (Some(terms), _) => terms.into_iter().filter(|t| t.len() >= 3).collect(),
        (None, Some(query)) if query.len() >= 3 => vec![query],
        (None, Some(_)) => {
            return Err(SearchError::InvalidQuerySize);
        }
        _ => vec![],
    };

    // no filters means search all
    let filters = req.filters.unwrap_or_default();
    let match_type = req.match_type;

    let mut tasks = FuturesUnordered::new();

    let include_all_items = req.include.is_empty();

    if include_all_items || req.include.contains(&UnifiedSearchIndex::Documents) {
        let query_params = SearchPaginationParams {
            page: Some(page),
            page_size: Some(page_size),
        };

        let request = DocumentSearchRequest {
            query: None,
            terms: Some(terms.clone()),
            match_type,
            filters: filters.document,
            search_on,
            collapse: Some(collapse),
        };

        let ctx = ctx.clone();
        let user_id = user_id.clone();

        tasks.push(boxed_search_future(
            async move { search_documents_enriched(&ctx, &user_id, &query_params, request).await },
            UnifiedSearchResponseItem::Document,
        ));
    }

    if include_all_items || req.include.contains(&UnifiedSearchIndex::Chats) {
        let query_params = SearchPaginationParams {
            page: Some(page),
            page_size: Some(page_size),
        };

        let request = ChatSearchRequest {
            query: None,
            terms: Some(terms.clone()),
            match_type,
            filters: filters.chat,
            search_on,
            collapse: Some(collapse),
        };

        let ctx = ctx.clone();
        let user_id = user_id.clone();

        tasks.push(boxed_search_future(
            async move { search_chats_enriched(&ctx, &user_id, &query_params, request).await },
            UnifiedSearchResponseItem::Chat,
        ));
    }

    if include_all_items || req.include.contains(&UnifiedSearchIndex::Emails) {
        let query_params = SearchPaginationParams {
            page: Some(page),
            page_size: Some(page_size),
        };

        let request = EmailSearchRequest {
            query: None,
            terms: Some(terms.clone()),
            match_type,
            filters: filters.email,
            search_on,
            collapse: Some(collapse),
        };

        let ctx = ctx.clone();
        let user_id = user_id.clone();

        tasks.push(boxed_search_future(
            async move { search_emails_enriched(&ctx, &user_id, &query_params, request).await },
            UnifiedSearchResponseItem::Email,
        ));
    }

    if include_all_items || req.include.contains(&UnifiedSearchIndex::Channels) {
        let query_params = SearchPaginationParams {
            page: Some(page),
            page_size: Some(page_size),
        };

        let request = ChannelSearchRequest {
            query: None,
            terms: Some(terms.clone()),
            match_type,
            filters: filters.channel,
            search_on,
            collapse: Some(collapse),
        };

        let ctx = ctx.clone();
        let user_id = user_id.clone();

        tasks.push(boxed_search_future(
            async move {
                search_channels_enriched(
                    &ctx,
                    &user_id,
                    user_organization_id,
                    &query_params,
                    request,
                )
                .await
            },
            UnifiedSearchResponseItem::Channel,
        ));
    }

    if include_all_items || req.include.contains(&UnifiedSearchIndex::Projects) {
        let query_params = SearchPaginationParams {
            page: Some(page),
            page_size: Some(page_size),
        };

        let request = ProjectSearchRequest {
            query: None,
            terms: Some(terms),
            match_type,
            filters: filters.project,
            search_on,
            collapse: Some(collapse),
        };

        let ctx = ctx.clone();
        let user_id = user_id.clone();

        tasks.push(boxed_search_future(
            async move { search_projects_enriched(&ctx, &user_id, &query_params, request).await },
            UnifiedSearchResponseItem::Project,
        ));
    }

    let mut results = Vec::new();

    while let Some(result) = tasks.next().await {
        match result {
            Ok(items) => results.extend(items),
            Err(err_response) => return Err(err_response),
        }
    }

    Ok((StatusCode::OK, Json(UnifiedSearchResponse { results })).into_response())
}
