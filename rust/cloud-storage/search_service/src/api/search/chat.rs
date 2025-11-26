use crate::api::ApiContext;
use crate::api::search::simple::SearchError;
use crate::api::search::simple::simple_chat::search_chats;
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::chat::{
    ChatMessageSearchResult, ChatSearchRequest, ChatSearchResponse, ChatSearchResponseItem,
    ChatSearchResponseItemWithMetadata,
};
use opensearch_client::search::model::SearchGotoContent;
use std::collections::HashMap;

use super::SearchPaginationParams;

/// Enriches chat search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_chats(
    ctx: &ApiContext,
    user_id: &str,
    results: Vec<opensearch_client::search::model::SearchHit>,
) -> Result<Vec<ChatSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<opensearch_client::search::model::SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == models_opensearch::SearchEntityType::Chats)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }
    // Extract chat IDs from results
    let chat_ids: Vec<String> = results.iter().map(|r| r.entity_id.clone()).collect();

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
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    chat_histories: HashMap<String, macro_db_client::chat::get::ChatHistoryInfo>,
) -> anyhow::Result<Vec<ChatSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits>
    let entity_id_hit_map: HashMap<String, Vec<ChatMessageSearchResult>> = search_results
        .into_iter()
        .map(|hit| {
            let result = if let Some(SearchGotoContent::Chats(goto)) = hit.goto {
                ChatMessageSearchResult {
                    chat_message_id: Some(goto.chat_message_id),
                    role: Some(goto.role),
                    highlight: hit.highlight.into(),
                    score: hit.score,
                }
            } else {
                // name match
                ChatMessageSearchResult {
                    chat_message_id: None,
                    role: None,
                    highlight: hit.highlight.into(),
                    score: hit.score,
                }
            };
            (hit.entity_id, result)
        })
        .fold(HashMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results
    let result: Vec<ChatSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            if let Some(info) = chat_histories.get(&entity_id) {
                let info = info.clone();
                let metadata = models_search::chat::ChatMetadata {
                    created_at: info.created_at.timestamp(),
                    updated_at: info.updated_at.timestamp(),
                    viewed_at: info.viewed_at.map(|a| a.timestamp()),
                    project_id: info.project_id.clone(),
                    deleted_at: info.deleted_at.map(|a| a.timestamp()),
                };
                Some(ChatSearchResponseItemWithMetadata {
                    metadata: Some(metadata),
                    extra: ChatSearchResponseItem {
                        id: entity_id.clone(),
                        chat_id: entity_id,
                        owner_id: info.user_id.clone(),
                        user_id: info.user_id,
                        name: info.name,
                        chat_search_results: hits,
                    },
                })
            } else {
                None
            }
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod test;
