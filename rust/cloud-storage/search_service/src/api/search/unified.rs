use super::SearchPaginationParams;
use crate::api::{
    ApiContext,
    search::{
        enrich::EnrichSearchResponse,
        simple::{SearchError, simple_unified::perform_unified_search},
    },
};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::unified::{UnifiedSearchRequest, UnifiedSearchResponse};
use opensearch_client::search::unified::SplitUnifiedSearchResponse;

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

    let results = perform_unified_search(&ctx, &user_context, query_params, req).await?;

    let (channel_results, chat_results, document_results, email_results, project_results) =
        results.into_iter().split_search_response();

    let (
        enriched_document_results,
        enriched_chat_results,
        enriched_channel_results,
        enriched_project_results,
        enriched_email_results,
    ) = tokio::try_join!(
        document_results
            .into_iter()
            .enrich_search_response(&ctx, &user_context.user_id),
        chat_results
            .into_iter()
            .enrich_search_response(&ctx, &user_context.user_id),
        channel_results
            .into_iter()
            .enrich_search_response(&ctx, &user_context.user_id),
        project_results
            .into_iter()
            .enrich_search_response(&ctx, &user_context.user_id),
        email_results
            .into_iter()
            .enrich_search_response(&ctx, &user_context.user_id)
    )
    .map_err(|e| SearchError::InternalError(anyhow::anyhow!("tokio error: {:?}", e)))?;

    let mut results = vec![];

    results.extend(enriched_document_results);
    results.extend(enriched_chat_results);
    results.extend(enriched_channel_results);
    results.extend(enriched_project_results);
    results.extend(enriched_email_results);

    // TODO: sort at the end. need to expose hit score first

    Ok((StatusCode::OK, Json(UnifiedSearchResponse { results })).into_response())
}
