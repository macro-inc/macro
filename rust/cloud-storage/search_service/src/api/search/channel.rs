use crate::api::search::simple::SearchError;
use indexmap::IndexMap;
use std::collections::HashMap;

use crate::api::ApiContext;
use model::comms::{ChannelHistoryInfo, GetChannelsHistoryRequest};
use models_search::channel::{
    ChannelSearchResponseItem, ChannelSearchResponseItemWithMetadata, ChannelSearchResult,
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
    let channel_ids: Vec<Uuid> = results.iter().map(|r| r.entity_id).collect();

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

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    channel_histories: HashMap<Uuid, ChannelHistoryInfo>,
) -> anyhow::Result<Vec<ChannelSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits> using IndexMap to preserve insertion order
    let entity_id_hit_map: IndexMap<sqlx::types::Uuid, Vec<ChannelSearchResult>> = search_results
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
            (hit.entity_id, result)
        })
        .fold(IndexMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results in the original search result order
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
                        id: entity_id,
                        channel_id: entity_id,
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
