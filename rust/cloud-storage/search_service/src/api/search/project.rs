use crate::api::search::simple::{SearchError, simple_project::search_projects};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::project::{
    ProjectSearchRequest, ProjectSearchResponse, ProjectSearchResponseItem,
    ProjectSearchResponseItemWithMetadata, ProjectSearchResult,
};
use std::collections::HashMap;

use crate::api::ApiContext;

use super::SearchPaginationParams;

/// Enriches project search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_projects(
    ctx: &ApiContext,
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
    let project_ids: Vec<String> = results.iter().map(|r| r.entity_id.clone()).collect();

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

/// Performs a search through projects and enriches the results with metadata
#[tracing::instrument(skip(ctx, query_params, req), err)]
pub async fn search_projects_enriched(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: ProjectSearchRequest,
) -> Result<Vec<ProjectSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results = search_projects(ctx, user_id, query_params, req).await?;

    enrich_projects(ctx, user_id, opensearch_results).await
}

/// Perform a search through your projects
#[utoipa::path(
        post,
        path = "/search/project",
        operation_id = "project_search",
        params(
            ("page" = Option<i64>, Query, description = "The page. Defaults to 0."),
            ("page_size" = Option<i64>, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=ProjectSearchResponse),
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
    extract::Json(req): extract::Json<ProjectSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("project_search");
    let user_id = user_context.user_id.as_str();

    let results = search_projects_enriched(&ctx, user_id, &query_params, req).await?;

    let result = ProjectSearchResponse { results };

    Ok((StatusCode::OK, Json(result)).into_response())
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    project_histories: HashMap<
        String,
        macro_db_client::projects::get_project_history::ProjectHistoryInfo,
    >,
) -> anyhow::Result<Vec<ProjectSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits>
    let entity_id_hit_map: HashMap<String, Vec<ProjectSearchResult>> = search_results
        .into_iter()
        .map(|hit| {
            let result = ProjectSearchResult {
                highlight: hit.highlight.into(),
                score: hit.score,
            };

            (hit.entity_id, result)
        })
        .fold(HashMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results
    let result: Vec<ProjectSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            if let Some(info) = project_histories.get(&entity_id) {
                let info = info.clone();
                let metadata = models_search::project::ProjectMetadata {
                    created_at: info.created_at.timestamp(),
                    updated_at: info.updated_at.timestamp(),
                    viewed_at: info.viewed_at.map(|a| a.timestamp()),
                    parent_project_id: info.parent_project_id.clone(),
                    deleted_at: info.deleted_at.map(|a| a.timestamp()),
                };
                Some(ProjectSearchResponseItemWithMetadata {
                    metadata: Some(metadata),
                    extra: ProjectSearchResponseItem {
                        id: entity_id.clone(),
                        owner_id: info.user_id.clone(),
                        name: info.name,
                        project_search_results: hits,
                        updated_at: info.updated_at.timestamp(),
                        created_at: info.created_at.timestamp(),
                    },
                })
            } else {
                None
            }
        })
        .collect();

    Ok(result)
}
