use crate::api::search::simple::SearchError;
use crate::{api::ApiContext, util};
use crate::{api::search::simple::simple_chat::search_chats, model::ChatOpenSearchResponse};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use macro_db_client::chat::get::ChatHistoryInfo;
use model::{response::ErrorResponse, user::UserContext};
use models_search::chat::{
    ChatMessageSearchResult, ChatSearchMetadata, ChatSearchRequest, ChatSearchResponse,
    ChatSearchResponseItem, ChatSearchResponseItemWithMetadata,
};
use std::collections::HashMap;

use super::SearchPaginationParams;

/// Enriches chat search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_chats(
    ctx: &ApiContext,
    user_id: &str,
    results: Vec<opensearch_client::search::chats::ChatSearchResponse>,
) -> Result<Vec<ChatSearchResponseItemWithMetadata>, SearchError> {
    if results.is_empty() {
        return Ok(vec![]);
    }
    // Extract chat IDs from results
    let chat_ids: Vec<String> = results.iter().map(|r| r.chat_id.clone()).collect();

    // Fetch chat metadata from database
    let chat_histories =
        macro_db_client::chat::get::get_chat_history_info(&ctx.db, user_id, &chat_ids)
            .await
            .map_err(SearchError::InternalError)?;

    // Construct enriched results
    let enriched_results =
        construct_search_result(results, chat_histories).map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

/// Performs a search through chats and enriches the results with metadata
pub async fn search_chats_enriched(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: ChatSearchRequest,
) -> Result<Vec<ChatSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results = search_chats(ctx, user_id, query_params, req).await?;

    enrich_chats(ctx, user_id, opensearch_results).await
}

/// Perform a search through your chats
#[utoipa::path(
        post,
        path = "/search/chat",
        operation_id = "chat_search",
        params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=ChatSearchResponse),
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
    extract::Json(req): extract::Json<ChatSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("chat_search");
    let user_id = user_context.user_id.as_str();

    let results = search_chats_enriched(&ctx, user_id, &query_params, req).await?;

    let result = ChatSearchResponse { results };

    Ok((StatusCode::OK, Json(result)).into_response())
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::chats::ChatSearchResponse>,
    chat_histories: HashMap<String, ChatHistoryInfo>,
) -> anyhow::Result<Vec<ChatSearchResponseItemWithMetadata>> {
    let search_results = search_results
        .into_iter()
        .map(|inner| ChatOpenSearchResponse { inner })
        .collect();
    let result = util::construct_search_result::<
        ChatOpenSearchResponse,
        ChatMessageSearchResult,
        ChatSearchMetadata,
    >(search_results)?;
    // To preserve backwards compatibility for now, convert back into old struct
    let result: Vec<ChatSearchResponseItem> = result.into_iter().map(|a| a.into()).collect();

    // Add metadata for each chat fetched from macrodb
    let result: Vec<ChatSearchResponseItemWithMetadata> = result
        .into_iter()
        .map(|item| {
            let chat_history_info = chat_histories
                .get(&item.chat_id)
                .cloned()
                .unwrap_or_default();
            ChatSearchResponseItemWithMetadata {
                created_at: chat_history_info.created_at.timestamp(),
                updated_at: chat_history_info.updated_at.timestamp(),
                viewed_at: chat_history_info.viewed_at.map(|a| a.timestamp()),
                project_id: chat_history_info.project_id,
                extra: item,
            }
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod test;
