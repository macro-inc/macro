use crate::api::search::simple::SearchError;
use indexmap::IndexMap;
use models_opensearch::SearchEntityType;
use models_properties::{EntityReference, EntityType};
use models_search::SearchHighlight;
use models_search::document::{
    DocumentSearchResponseItem, DocumentSearchResponseItemWithMetadata, DocumentSearchResult,
};
use models_soup::SoupProperty;
use name_search::highlight_name;
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
    search_term: Option<&str>,
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

    // Fetch properties for markdown documents (tasks, etc.)
    let md_entity_refs: Vec<EntityReference> = document_histories
        .iter()
        .filter(|(_, info)| info.file_type.as_deref() == Some("md"))
        .map(|(id, info)| {
            let entity_type = match info.sub_type {
                Some(document_sub_type::DocumentSubType::Task) => EntityType::Task,
                _ => EntityType::Document,
            };
            EntityReference::new(id.clone(), entity_type)
        })
        .collect();

    let properties_map = if !md_entity_refs.is_empty() {
        properties_db_client::entity_properties::get::get_bulk_entity_properties_values(
            &ctx.db,
            &md_entity_refs,
        )
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to fetch entity properties"))
        .unwrap_or_default()
        .into_iter()
        .map(|(id, props)| {
            (
                id,
                props
                    .into_iter()
                    .map(SoupProperty::from)
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<HashMap<_, _>>()
    } else {
        HashMap::new()
    };

    // Construct enriched results
    let enriched_results =
        construct_search_result(results, document_histories, properties_map, search_term)
            .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    document_histories: HashMap<
        String,
        macro_db_client::document::get_document_history::DocumentHistoryInfo,
    >,
    properties_map: HashMap<String, Vec<SoupProperty>>,
    search_term: Option<&str>,
) -> anyhow::Result<Vec<DocumentSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits> using IndexMap to preserve insertion order
    let mut entity_id_hit_map: IndexMap<Uuid, Vec<DocumentSearchResult>> = search_results
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

    // Docs that appear via content hits may still have a name that matches the
    // query, but the OpenSearch content query does not search the name field so
    // no `highlight.name` comes back. Synthesize one from the doc's name so the
    // sidebar can render the name highlight for those rows too.
    if let Some(term) = search_term {
        for (entity_id, hits) in entity_id_hit_map.iter_mut() {
            if hits.iter().any(|h| h.highlight.name.is_some()) {
                continue;
            }
            let Some(info) = document_histories.get(&entity_id.to_string()) else {
                continue;
            };
            let Some(highlighted) = highlight_name(&info.file_name, term) else {
                continue;
            };
            hits.push(DocumentSearchResult {
                node_id: None,
                highlight: SearchHighlight {
                    name: Some(highlighted),
                    ..Default::default()
                },
                raw_content: None,
                score: None,
            });
        }
    }

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
                let properties = properties_map
                    .get(&entity_id.to_string())
                    .cloned()
                    .filter(|p| !p.is_empty());
                Some(DocumentSearchResponseItemWithMetadata {
                    metadata: Some(metadata),
                    properties,
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
