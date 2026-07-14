use crate::api::search::simple::SearchError;
use item_filters::ProjectFilters;
use model::item::{ShareableItem, ShareableItemType};

use crate::api::context::SearchHandlerState;

#[derive(Debug)]
pub(in crate::api::search) struct FilterProjectResponse {
    pub project_ids: Vec<String>,
    pub ids_only: bool,
}

#[tracing::instrument(skip(ctx, filters), err)]
pub(in crate::api::search) async fn filter_projects(
    ctx: &SearchHandlerState,
    user_id: &str,
    filters: &ProjectFilters,
) -> Result<FilterProjectResponse, SearchError> {
    let project_ids: Vec<String> = if !filters.project_ids.is_empty() {
        // Item ids are provided, we want to get the list of those that are accessible to the user
        macro_db_client::item_access::validate_user_accessible_items(
            &ctx.db,
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
        macro_db_client::item_access::get_accessible_items::get_user_accessible_items(
            &ctx.db,
            user_id,
            Some("project".to_string()),
            should_exclude_owner,
        )
        .await
        .map_err(SearchError::InternalError)?
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
