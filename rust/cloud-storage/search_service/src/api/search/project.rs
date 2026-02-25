use crate::api::search::simple::SearchError;
use indexmap::IndexMap;
use models_search::project::{
    ProjectSearchResponseItem, ProjectSearchResponseItemWithMetadata, ProjectSearchResult,
};
use sqlx::types::Uuid;
use std::collections::HashMap;

use crate::api::context::SearchHandlerState;

/// Enriches project search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_projects(
    ctx: &SearchHandlerState,
    user_id: &str,
    results: Vec<opensearch_client::search::model::SearchHit>,
) -> Result<Vec<ProjectSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<opensearch_client::search::model::SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == models_opensearch::SearchEntityType::Projects)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }
    // Extract project IDs from results
    let project_ids: Vec<String> = results.iter().map(|r| r.entity_id.to_string()).collect();

    // Fetch project metadata from database
    let project_histories =
        macro_db_client::projects::get_project_history::get_project_history_info(
            &ctx.db,
            user_id,
            &project_ids,
        )
        .await
        .map_err(SearchError::InternalError)?;

    // Construct enriched results
    let enriched_results =
        construct_search_result(results, project_histories).map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    project_histories: HashMap<
        String,
        macro_db_client::projects::get_project_history::ProjectHistoryInfo,
    >,
) -> anyhow::Result<Vec<ProjectSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits> using IndexMap to preserve insertion order
    let entity_id_hit_map: IndexMap<Uuid, Vec<ProjectSearchResult>> = search_results
        .into_iter()
        .map(|hit| {
            let result = ProjectSearchResult {
                highlight: hit.highlight.into(),
                score: hit.score,
            };

            (hit.entity_id, result)
        })
        .fold(IndexMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results in the original search result order
    let result: Vec<ProjectSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            if let Some(info) = project_histories.get(&entity_id.to_string()) {
                let info = info.clone();
                let metadata = models_search::project::ProjectMetadata {
                    created_at: info.created_at,
                    updated_at: info.updated_at,
                    viewed_at: info.viewed_at,
                    parent_project_id: info.parent_project_id.clone(),
                    deleted_at: info.deleted_at,
                };
                Some(ProjectSearchResponseItemWithMetadata {
                    metadata: Some(metadata),
                    extra: ProjectSearchResponseItem {
                        id: entity_id,
                        owner_id: info.user_id.clone(),
                        name: info.name,
                        project_search_results: hits,
                        updated_at: info.updated_at,
                        created_at: info.created_at,
                    },
                })
            } else {
                None
            }
        })
        .collect();

    Ok(result)
}
