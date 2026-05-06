use crate::api::search::simple::SearchError;
use chrono::{DateTime, Utc};
use indexmap::IndexMap;
use std::collections::HashMap;

use crate::api::context::SearchHandlerState;
use model::comms::ChannelHistoryInfo;
use models_search::channel::{
    ChannelSearchResponseItem, ChannelSearchResponseItemWithMetadata, ChannelSearchResult,
};
use opensearch_client::search::model::SearchGotoContent;
use sqlx::types::Uuid;

/// Enriches channel message search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_channels(
    ctx: &SearchHandlerState,
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

    // Extract message IDs from results so we can flag any that have been deleted.
    let message_ids: Vec<Uuid> = results
        .iter()
        .filter_map(|r| match &r.goto {
            Some(SearchGotoContent::Channels(goto)) => Some(goto.channel_message_id),
            _ => None,
        })
        .collect();

    let (channel_histories, message_states) = tokio::try_join!(
        async {
            comms_db_client::activity::get_activity::get_channel_history_info(
                &ctx.db,
                user_id,
                &channel_ids,
            )
            .await
            .map_err(anyhow::Error::from)
        },
        async {
            comms_db_client::messages::get_deleted_ats::get_message_deletion_states(
                &ctx.db,
                &message_ids,
            )
            .await
        },
    )
    .map_err(SearchError::InternalError)?;

    // Construct enriched results
    let enriched_results = construct_search_result(results, channel_histories, message_states)
        .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    channel_histories: HashMap<Uuid, ChannelHistoryInfo>,
    message_states: HashMap<Uuid, Option<DateTime<Utc>>>,
) -> anyhow::Result<Vec<ChannelSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits> using IndexMap to preserve insertion order
    let entity_id_hit_map: IndexMap<sqlx::types::Uuid, Vec<ChannelSearchResult>> = search_results
        .into_iter()
        .filter_map(|hit| {
            let result = if let Some(SearchGotoContent::Channels(goto)) = hit.goto {
                // Drop content-match hits whose underlying message no longer exists in
                // the DB — those are stale OpenSearch entries (e.g. hard-deleted) that
                // shouldn't surface to users.
                let deleted_at = *message_states.get(&goto.channel_message_id)?;
                ChannelSearchResult {
                    highlight: hit.highlight.into(),
                    score: hit.score,
                    message_id: Some(goto.channel_message_id),
                    thread_id: goto.thread_id,
                    sender_id: Some(goto.sender_id),
                    created_at: Some(goto.created_at),
                    updated_at: Some(goto.updated_at),
                    deleted_at,
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
                    deleted_at: None,
                }
            };
            Some((hit.entity_id, result))
        })
        .fold(IndexMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results in the original search result order
    let result: Vec<ChannelSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, mut hits)| {
            // OpenSearch sorts content matches by created_at DESC, but ties on the
            // second resolution are non-deterministic. message_id is uuidv7
            // (time-ordered), so it can be used as a tiebreaker. Sort DESC to keep newer
            // messages first, matching the primary sort.
            hits.sort_by(|a, b| {
                b.created_at
                    .cmp(&a.created_at)
                    .then_with(|| b.message_id.cmp(&a.message_id))
            });

            if let Some(info) = channel_histories.get(&entity_id) {
                let info = info.clone();
                let metadata = models_search::channel::ChannelMetadata {
                    created_at: info.created_at,
                    updated_at: info.updated_at,
                    viewed_at: info.viewed_at,
                    interacted_at: info.interacted_at,
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
