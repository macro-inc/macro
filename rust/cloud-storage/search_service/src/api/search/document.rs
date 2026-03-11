use crate::api::search::simple::SearchError;
use indexmap::IndexMap;
use models_opensearch::SearchEntityType;
use models_search::document::{
    DocumentSearchResponseItem, DocumentSearchResponseItemWithMetadata, DocumentSearchResult,
};
use opensearch_client::search::model::SearchGotoContent;
use sqlx::types::Uuid;
use std::collections::HashMap;

use crate::api::context::SearchHandlerState;

/// Enriches document search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_documents(
    ctx: &SearchHandlerState,
    user_id: &str,
    results: Vec<opensearch_client::search::model::SearchHit>,
) -> Result<Vec<DocumentSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<opensearch_client::search::model::SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == SearchEntityType::Documents)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }
    // Extract document IDs from results
    let document_ids: Vec<String> = results.iter().map(|r| r.entity_id.to_string()).collect();

    // Fetch document metadata from database
    let document_histories =
        macro_db_client::document::get_document_history::get_document_history_info(
            &ctx.db,
            user_id,
            &document_ids,
        )
        .await
        .map_err(SearchError::InternalError)?;

    // Construct enriched results
    let enriched_results =
        construct_search_result(results, document_histories).map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    document_histories: HashMap<
        String,
        macro_db_client::document::get_document_history::DocumentHistoryInfo,
    >,
) -> anyhow::Result<Vec<DocumentSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits> using IndexMap to preserve insertion order
    let entity_id_hit_map: IndexMap<Uuid, Vec<DocumentSearchResult>> = search_results
        .into_iter()
        .map(|hit| {
            let result = if let Some(SearchGotoContent::Documents(goto)) = hit.goto {
                DocumentSearchResult {
                    node_id: Some(goto.node_id),
                    highlight: hit.highlight.into(),
                    raw_content: goto.raw_content,
                    score: hit.score,
                }
            } else {
                // name match
                DocumentSearchResult {
                    node_id: None,
                    highlight: hit.highlight.into(),
                    raw_content: None,
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
    let result: Vec<DocumentSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            if let Some(info) = document_histories.get(&entity_id.to_string()) {
                let info = info.clone();
                let metadata = models_search::document::DocumentMetadata {
                    created_at: info.created_at,
                    updated_at: info.updated_at,
                    viewed_at: info.viewed_at,
                    project_id: info.project_id.clone(),
                    deleted_at: info.deleted_at,
                };
                Some(DocumentSearchResponseItemWithMetadata {
                    metadata: Some(metadata),
                    extra: DocumentSearchResponseItem {
                        id: entity_id,
                        name: info.file_name.clone(),
                        document_id: entity_id,
                        document_name: info.file_name,
                        owner_id: info.owner,
                        file_type: info.file_type,
                        sub_type: info.sub_type,
                        document_search_results: hits,
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
