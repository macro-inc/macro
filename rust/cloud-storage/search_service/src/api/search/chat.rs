use crate::api::context::SearchHandlerState;
use crate::api::search::simple::SearchError;
use indexmap::IndexMap;
use models_search::chat::{
    ChatMessageSearchResult, ChatSearchResponseItem, ChatSearchResponseItemWithMetadata,
};
use opensearch_client::search::model::SearchGotoContent;
use sqlx::types::Uuid;
use std::collections::HashMap;

/// Enriches chat search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_chats(
    ctx: &SearchHandlerState,
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
    let chat_ids: Vec<String> = results.iter().map(|r| r.entity_id.to_string()).collect();

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

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    chat_histories: HashMap<String, macro_db_client::chat::get::ChatHistoryInfo>,
) -> anyhow::Result<Vec<ChatSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits> using IndexMap to preserve insertion order
    let entity_id_hit_map: IndexMap<Uuid, Vec<ChatMessageSearchResult>> = search_results
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
        .fold(IndexMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results in the original search result order
    let result: Vec<ChatSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            if let Some(info) = chat_histories.get(&entity_id.to_string()) {
                let info = info.clone();
                let metadata = models_search::chat::ChatMetadata {
                    created_at: info.created_at,
                    updated_at: info.updated_at,
                    viewed_at: info.viewed_at,
                    project_id: info.project_id.clone(),
                    deleted_at: info.deleted_at,
                };
                Some(ChatSearchResponseItemWithMetadata {
                    metadata: Some(metadata),
                    extra: ChatSearchResponseItem {
                        id: entity_id,
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
