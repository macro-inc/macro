use super::SearchPaginationParams;
use crate::api::{
    context::SearchHandlerState,
    search::{
        enrich::enrich_search_response,
        simple::{SearchError, simple_unified::perform_unified_search},
    },
};
use axum::{
    Extension,
    extract::{self, State},
    response::Json,
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::unified::{
    UnifiedSearchRequest, UnifiedSearchResponse, UnifiedSearchResponseItem,
};
use opensearch_client::search::unified::{
    SplitUnifiedSearchResponse, SplitUnifiedSearchResponseValues,
};
use std::cmp::Ordering;

/// Perform a search through all items
#[utoipa::path(
    post,
    path = "/search",
    operation_id = "unified_search",
    params(
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
            ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value.")
    ),
    responses(
            (status = 200, body=UnifiedSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
pub async fn handler(
    State(ctx): State<SearchHandlerState>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<UnifiedSearchRequest>,
) -> Result<Json<UnifiedSearchResponse>, SearchError> {
    tracing::info!(user_id = user_context.user_id, "unified_search");

    let (results, next_cursor) =
        perform_unified_search(&ctx, &user_context, query_params, req).await?;

    // Split the results by entity type
    let SplitUnifiedSearchResponseValues {
        channel_message,
        chat,
        document,
        email,
        project,
    } = {
        let _span = tracing::info_span!("split_search_response_by_type").entered();
        results.into_iter().split_search_response()
    };

    let (
        enriched_document_results,
        enriched_chat_results,
        enriched_channel_results,
        enriched_project_results,
        enriched_email_results,
    ) = tokio::try_join!(
        enrich_search_response(
            &ctx,
            &user_context.user_id,
            document,
            models_opensearch::SearchEntityType::Documents
        ),
        enrich_search_response(
            &ctx,
            &user_context.user_id,
            chat,
            models_opensearch::SearchEntityType::Chats
        ),
        enrich_search_response(
            &ctx,
            &user_context.user_id,
            channel_message,
            models_opensearch::SearchEntityType::Channels
        ),
        enrich_search_response(
            &ctx,
            &user_context.user_id,
            project,
            models_opensearch::SearchEntityType::Projects
        ),
        enrich_search_response(
            &ctx,
            &user_context.user_id,
            email,
            models_opensearch::SearchEntityType::Emails
        ),
    )
    .map_err(|e| SearchError::InternalError(anyhow::anyhow!("tokio error: {:?}", e)))?;

    let results = {
        let _span = tracing::info_span!("combine_and_sort_enriched_results").entered();

        let mut results = vec![];

        results.extend(enriched_document_results);
        results.extend(enriched_chat_results);
        results.extend(enriched_channel_results);
        results.extend(enriched_project_results);
        results.extend(enriched_email_results);

        sort_unified_search_results(results)
    };

    Ok(Json(UnifiedSearchResponse {
        results,
        next_cursor,
    }))
}

/// Sorts the unified results
/// This method is so we can more easily test sorting
#[tracing::instrument(skip(results), fields(count = results.len()))]
fn sort_unified_search_results(
    mut results: Vec<UnifiedSearchResponseItem>,
) -> Vec<UnifiedSearchResponseItem> {
    // Sort the results by their updated_at
    results.sort_by(|a, b| {
        b.updated_at()
            .partial_cmp(&a.updated_at())
            .unwrap_or(Ordering::Equal)
    });

    results
}

#[cfg(test)]
mod test;
