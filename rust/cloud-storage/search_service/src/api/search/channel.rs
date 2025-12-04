use crate::api::search::simple::{SearchError, simple_channel::search_channels};
use std::collections::HashMap;

use super::SearchPaginationParams;
use crate::api::ApiContext;
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::comms::{ChannelHistoryInfo, GetChannelsHistoryRequest};
use model::{response::ErrorResponse, user::UserContext};
use models_search::channel::{
    ChannelSearchRequest, ChannelSearchResponse, ChannelSearchResponseItem,
    ChannelSearchResponseItemWithMetadata, ChannelSearchResult,
};
use opensearch_client::search::model::SearchGotoContent;
use sqlx::types::Uuid;

/// Enriches channel message search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_channels(
    ctx: &ApiContext,
    user_id: &str,
    results: Vec<opensearch_client::search::model::SearchHit>,
) -> Result<Vec<ChannelSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<opensearch_client::search::model::SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == models_opensearch::SearchEntityType::Channels)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }

    // Extract channel IDs from results
    let channel_ids: Vec<Uuid> = results
        .iter()
        .map(|r| r.entity_id.parse().unwrap())
        .collect();

    // Fetch channel metadata from comms service
    let channel_histories = ctx
        .comms_service_client
        .get_channels_history(GetChannelsHistoryRequest {
            user_id: user_id.to_string(),
            channel_ids,
        })
        .await
        .map_err(|e| SearchError::InternalError(e.into()))?;

    // Construct enriched results
    let enriched_results = construct_search_result(results, channel_histories.channels_history)
        .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

/// Performs a search through channels and enriches the results with metadata
#[tracing::instrument(skip(ctx, req, query_params, user_organization_id), err)]
pub async fn search_channels_enriched(
    ctx: &ApiContext,
    user_id: &str,
    user_organization_id: Option<i32>,
    query_params: &SearchPaginationParams,
    req: ChannelSearchRequest,
) -> Result<Vec<ChannelSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results =
        search_channels(ctx, user_id, user_organization_id, query_params, req).await?;

    enrich_channels(ctx, user_id, opensearch_results).await
}

/// Perform a search through your emails
#[utoipa::path(
        post,
        path = "/search/channel",
        operation_id = "channel_search",
        params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=ChannelSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, query_params), fields(user_id=user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<ChannelSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("channel_search");

    let results = search_channels_enriched(
        &ctx,
        user_context.user_id.as_str(),
        user_context.organization_id,
        &query_params,
        req,
    )
    .await?;

    let result = ChannelSearchResponse { results };

    Ok((StatusCode::OK, Json(result)).into_response())
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    channel_histories: HashMap<Uuid, ChannelHistoryInfo>,
) -> anyhow::Result<Vec<ChannelSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits>
    let entity_id_hit_map: HashMap<sqlx::types::Uuid, Vec<ChannelSearchResult>> = search_results
        .into_iter()
        .map(|hit| {
            let result = if let Some(SearchGotoContent::Channels(goto)) = hit.goto {
                ChannelSearchResult {
                    highlight: hit.highlight.into(),
                    score: hit.score,
                    message_id: Some(goto.channel_message_id),
                    thread_id: goto.thread_id,
                    sender_id: Some(goto.sender_id),
                    created_at: Some(goto.created_at),
                    updated_at: Some(goto.updated_at),
                }
            } else {
                // name match
                ChannelSearchResult {
                    highlight: hit.highlight.into(),
                    score: hit.score,
                    message_id: None,
                    thread_id: None,
                    sender_id: None,
                    created_at: None,
                    updated_at: None,
                }
            };
            (hit.entity_id.parse().unwrap(), result)
        })
        .fold(HashMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results
    let result: Vec<ChannelSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            if let Some(info) = channel_histories.get(&entity_id) {
                let info = info.clone();
                let metadata = models_search::channel::ChannelMetadata {
                    created_at: info.created_at.timestamp(),
                    updated_at: info.updated_at.timestamp(),
                    viewed_at: info.viewed_at.map(|a| a.timestamp()),
                    interacted_at: info.interacted_at.map(|a| a.timestamp()),
                };
                Some(ChannelSearchResponseItemWithMetadata {
                    metadata: Some(metadata),
                    extra: ChannelSearchResponseItem {
                        id: entity_id.to_string(),
                        channel_id: entity_id.to_string(),
                        owner_id: Some(info.user_id),
                        channel_type: info.channel_type,
                        channel_message_search_results: hits,
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
