use crate::api::search::simple::SearchError;
use item_filters::ProjectFilters;
use macro_user_id::user_id::MacroUserId;
use model::item::{ShareableItem, ShareableItemType};
use opensearch_client::search::model::{Highlight, SearchHit};
use sqlx::{Pool, Postgres, types::Uuid};

use crate::api::ApiContext;

#[derive(Debug)]
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

/// Performs the name search over project names
#[tracing::instrument(skip(db), err)]
pub(in crate::api::search::simple) async fn search_names<'a>(
    db: &Pool<Postgres>,
    user_id: &MacroUserId<macro_user_id::lowercased::Lowercase<'a>>,
    filter_project_response: &FilterProjectResponse,
    term: String,
    limit: u32,
    cursor: models_search_cursor::SearchCursorOption,
) -> Result<(Vec<SearchHit>, models_search_cursor::SearchCursorOption), SearchError> {
    // If cursor is Done, no more results to fetch
    let inner_cursor = match cursor {
        models_search_cursor::SearchCursorOption::Done => {
            return Ok((vec![], models_search_cursor::SearchCursorOption::Done));
        }
        models_search_cursor::SearchCursorOption::NotDone(c) => c,
    };

    let project_uuids = filter_project_response
        .project_ids
        .iter()
        .map(|p| p.parse().unwrap())
        .collect::<Vec<Uuid>>();

    name_search::search_project_names(
        db,
        user_id,
        &project_uuids,
        term,
        filter_project_response.ids_only,
        limit,
        inner_cursor,
    )
    .await
    .map_err(SearchError::NameSearch)
    .map(|response| {
        let hits = response
            .items
            .into_iter()
            .map(|n| SearchHit {
                entity_id: n.entity_id,
                entity_type: n.entity_type,
                score: None,
                highlight: Highlight {
                    name: Some(n.name),
                    ..Default::default()
                },
                goto: None,
                updated_at: Some(n.updated_at),
            })
            .collect();
        (hits, response.cursor)
    })
}
