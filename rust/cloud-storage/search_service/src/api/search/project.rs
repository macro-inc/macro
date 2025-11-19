use crate::{
    api::search::simple::{SearchError, simple_project::search_projects},
    model::ProjectOpenSearchResponse,
};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::project::{
    ProjectSearchMetadata, ProjectSearchRequest, ProjectSearchResponse, ProjectSearchResponseItem,
    ProjectSearchResponseItemWithMetadata, ProjectSearchResult,
};
use std::collections::HashMap;

use crate::{api::ApiContext, util};

use super::SearchPaginationParams;

/// Performs a search through projects and enriches the results with metadata
pub async fn search_projects_enriched(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: ProjectSearchRequest,
) -> Result<Vec<ProjectSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results = search_projects(ctx, user_id, query_params, req).await?;

    // Extract project IDs from results
    let project_ids: Vec<String> = opensearch_results
        .iter()
        .map(|r| r.project_id.clone())
        .collect();

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
    let enriched_results = construct_search_result(opensearch_results, project_histories)
        .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
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
    search_results: Vec<opensearch_client::search::projects::ProjectSearchResponse>,
    project_histories: HashMap<
        String,
        macro_db_client::projects::get_project_history::ProjectHistoryInfo,
    >,
) -> anyhow::Result<Vec<ProjectSearchResponseItemWithMetadata>> {
    let search_results = search_results
        .into_iter()
        .map(|inner| ProjectOpenSearchResponse { inner })
        .collect();
    let result = util::construct_search_result::<
        ProjectOpenSearchResponse,
        ProjectSearchResult,
        ProjectSearchMetadata,
    >(search_results)?;
    let result: Vec<ProjectSearchResponseItem> = result.into_iter().map(|a| a.into()).collect();
    // Add metadata for each project, fetched from macrodb
    let result: Vec<ProjectSearchResponseItemWithMetadata> = result
        .into_iter()
        .map(|item| {
            let metadata = project_histories.get(&item.id).map(|info| {
                models_search::project::ProjectMetadata {
                    created_at: info.created_at.timestamp(),
                    updated_at: info.updated_at.timestamp(),
                    viewed_at: info.viewed_at.map(|a| a.timestamp()),
                    parent_project_id: info.parent_project_id.clone(),
                    deleted_at: info.deleted_at.map(|a| a.timestamp()),
                }
            });

            ProjectSearchResponseItemWithMetadata {
                metadata,
                extra: item,
            }
        })
        .collect();

    Ok(result)
}
