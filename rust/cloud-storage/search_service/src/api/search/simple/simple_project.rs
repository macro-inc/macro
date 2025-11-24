use crate::api::search::{SearchPaginationParams, simple::SearchError};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use item_filters::ProjectFilters;
use model::{
    item::{ShareableItem, ShareableItemType},
    response::ErrorResponse,
    user::UserContext,
};
use models_search::SearchOn;
use models_search::project::{ProjectSearchRequest, SimpleProjectSearchResponse};
use opensearch_client::search::projects::ProjectSearchArgs;

use crate::api::ApiContext;

/// Perform a search through your projects
/// This is a simple search where we do not group your results by project id.
#[utoipa::path(
        post,
        path = "/search/simple/project",
        operation_id = "simple_project_search",
        params(
            ("page" = Option<i64>, Query, description = "The page. Defaults to 0."),
            ("page_size" = Option<i64>, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=SimpleProjectSearchResponse),
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
    tracing::info!("simple_project_search");

    let results = search_projects(&ctx, user_context.user_id.as_str(), &query_params, req).await?;

    Ok((
        StatusCode::OK,
        Json(SimpleProjectSearchResponse {
            results: results.into_iter().map(|a| a.into()).collect(),
        }),
    )
        .into_response())
}

pub(in crate::api::search) struct FilterProjectResponse {
    pub project_ids: Vec<String>,
    pub ids_only: bool,
}

pub(in crate::api::search) async fn filter_projects(
    ctx: &ApiContext,
    user_id: &str,
    filters: &ProjectFilters,
) -> Result<FilterProjectResponse, SearchError> {
    let project_ids: Vec<String> = if !filters.project_ids.is_empty() {
        // Item ids are provided, we want to get the list of those that are accessible to the user
        ctx.dss_client
            .validate_user_accessible_item_ids(
                user_id,
                filters
                    .project_ids
                    .iter()
                    .map(|id| ShareableItem {
                        item_id: id.to_string(),
                        item_type: ShareableItemType::Project,
                    })
                    .collect(),
            )
            .await
            .map_err(SearchError::InternalError)?
            .into_iter()
            .map(|a| a.item_id)
            .collect()
    } else {
        // If both the project_ids and owners are empty, we want to get the list of everything the has access to but does not own
        // Otherwise, we need a list of all items the user has access to including what they own
        let should_exclude_owner = filters.project_ids.is_empty() && filters.owners.is_empty();

        // No filters are provided, we want to get the list of everything the has access to but does not own
        ctx.dss_client
            .get_user_accessible_item_ids(
                user_id,
                Some("project".to_string()),
                Some(should_exclude_owner),
            )
            .await
            .map_err(SearchError::InternalError)?
            .items
            .into_iter()
            .map(|a| a.item_id)
            .collect()
    };

    let ids_only = !filters.project_ids.is_empty() || !filters.owners.is_empty();

    // Projects are a special case, if you provide project_ids you are actually
    // looking over all items *within* those projects.
    let project_ids = if !filters.project_ids.is_empty() {
        // Get all sub-project ids
        macro_db_client::projects::get_sub_project_ids(&ctx.db, &project_ids)
            .await
            .map_err(SearchError::InternalError)?
    } else {
        project_ids
    };

    if project_ids.is_empty() && ids_only {
        return Ok(FilterProjectResponse {
            project_ids: vec![],
            ids_only,
        });
    }

    let project_ids = if !filters.owners.is_empty() {
        macro_db_client::items::filter::filter_items_by_owner_ids(
            &ctx.db,
            &project_ids,
            ShareableItemType::Project,
            &filters.owners,
        )
        .await
        .map_err(SearchError::InternalError)?
    } else {
        project_ids
    };

    Ok(FilterProjectResponse {
        project_ids,
        ids_only,
    })
}

pub(in crate::api::search) async fn search_projects(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: ProjectSearchRequest,
) -> Result<Vec<opensearch_client::search::projects::ProjectSearchResponse>, SearchError> {
    // content search is not applicable for projects
    if req.search_on == SearchOn::Content {
        return Ok(Vec::new());
    }

    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }

    let page = query_params.page.unwrap_or(0);

    let page_size = if let Some(page_size) = query_params.page_size {
        if !(0..=100).contains(&page_size) {
            return Err(SearchError::InvalidPageSize);
        }
        page_size
    } else {
        10
    };

    let terms: Vec<String> = if let Some(terms) = req.terms {
        terms
            .into_iter()
            .filter_map(|t| if t.len() < 3 { None } else { Some(t) })
            .collect()
    } else if let Some(query) = req.query {
        if query.len() < 3 {
            return Err(SearchError::InvalidQuerySize);
        }

        vec![query]
    } else {
        return Err(SearchError::NoQueryOrTermsProvided);
    };

    let filters = req.filters.unwrap_or_default();

    let filter_project_response = filter_projects(ctx, user_id, &filters).await?;

    if filter_project_response.project_ids.is_empty() && filter_project_response.ids_only {
        return Ok(Vec::new());
    }

    let results = ctx
        .opensearch_client
        .search_project(ProjectSearchArgs {
            terms,
            user_id: user_id.to_string(),
            page,
            page_size,
            match_type: req.match_type.to_string(),
            project_ids: filter_project_response.project_ids,
            search_on: req.search_on.into(),
            collapse: req.collapse.unwrap_or(false),
            ids_only: filter_project_response.ids_only,
            disable_recency: req.disable_recency,
        })
        .await
        .map_err(SearchError::Search)?;

    Ok(results)
}
