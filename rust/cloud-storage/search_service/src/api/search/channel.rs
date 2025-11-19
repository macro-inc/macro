use crate::{
    api::search::simple::{SearchError, simple_channel::search_channels},
    model::ChannelOpenSearchResponse,
};
use std::collections::HashMap;

use super::SearchPaginationParams;
use crate::{api::ApiContext, util};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::comms::{ChannelHistoryInfo, GetChannelsHistoryRequest};
use model::{response::ErrorResponse, user::UserContext};
use models_search::channel::{
    ChannelSearchMetadata, ChannelSearchRequest, ChannelSearchResponse, ChannelSearchResponseItem,
    ChannelSearchResponseItemWithMetadata, ChannelSearchResult,
};
use sqlx::types::Uuid;

/// Performs a search through channels and enriches the results with metadata
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

    // Extract channel IDs from results
    let channel_ids: Vec<Uuid> = opensearch_results
        .iter()
        .filter_map(|r| {
            match Uuid::parse_str(&r.channel_id) {
                Ok(uuid) => Some(uuid),
                Err(e) => {
                    tracing::warn!(error=?e, channel_id=?r.channel_id, "Failed to parse channel ID as UUID");
                    None
                }
            }
        })
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
    let enriched_results =
        construct_search_result(opensearch_results, channel_histories.channels_history)
            .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
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
    search_results: Vec<opensearch_client::search::channels::ChannelMessageSearchResponse>,
    channel_histories: HashMap<Uuid, ChannelHistoryInfo>,
) -> anyhow::Result<Vec<ChannelSearchResponseItemWithMetadata>> {
    let search_results = search_results
        .into_iter()
        .map(|inner| ChannelOpenSearchResponse { inner })
        .collect();
    let result = util::construct_search_result::<
        ChannelOpenSearchResponse,
        ChannelSearchResult,
        ChannelSearchMetadata,
    >(search_results)?;
    // To preserve backwards compatibility for now, convert back into old struct
    let result: Vec<ChannelSearchResponseItem> = result.into_iter().map(|a| a.into()).collect();

    let result: Vec<ChannelSearchResponseItemWithMetadata> = result
        .into_iter()
        .map(|item| {
            let metadata = Uuid::parse_str(&item.channel_id)
                .ok()
                .and_then(|channel_uuid| channel_histories.get(&channel_uuid))
                .map(
                    |channel_history_info| models_search::channel::ChannelMetadata {
                        created_at: channel_history_info.created_at.timestamp(),
                        updated_at: channel_history_info.updated_at.timestamp(),
                        viewed_at: channel_history_info.viewed_at.map(|a| a.timestamp()),
                        interacted_at: channel_history_info.interacted_at.map(|a| a.timestamp()),
                    },
                );

            ChannelSearchResponseItemWithMetadata {
                metadata,
                extra: item,
            }
        })
        .collect();
    Ok(result)
}

#[cfg(test)]
mod test;
