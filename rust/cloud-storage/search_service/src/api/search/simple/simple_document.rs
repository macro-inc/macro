use crate::api::search::simple::SearchError;
use item_filters::DocumentFilters;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model::item::{ShareableItem, ShareableItemType, UserAccessibleItem};
use opensearch_client::search::model::{Highlight, SearchHit};
use sqlx::{Pool, Postgres, types::Uuid};

use crate::api::context::SearchHandlerState;

#[derive(Debug)]
pub(in crate::api::search) struct FilterDocumentResponse {
    pub document_ids: Vec<String>,
    pub ids_only: bool,
}

pub(in crate::api::search) async fn filter_documents(
    ctx: &SearchHandlerState,
    user_id: &str,
    filters: &DocumentFilters,
) -> Result<FilterDocumentResponse, SearchError> {
    let document_ids_response: Vec<UserAccessibleItem> = if !filters.document_ids.is_empty() {
        // Item ids are provided, we want to get the list of those that are accessible to the user
        macro_db_client::item_access::validate_user_accessible_items(
            &ctx.db,
            user_id,
            filters
                .document_ids
                .iter()
                .map(|id| ShareableItem {
                    item_id: id.to_string(),
                    item_type: ShareableItemType::Document,
                })
                .collect(),
        )
        .await
        .map_err(SearchError::InternalError)?
    } else {
        // If both the project_ids and owners are empty, we want to get the list of everything the has access to but does not own
        // Otherwise, we need a list of all items the user has access to including what they own
        let should_exclude_owner = filters.project_ids.is_empty()
            && filters.owners.is_empty()
            && filters.file_types.is_empty();

        // No filters are provided, we want to get the list of everything the has access to but does not own
        macro_db_client::item_access::get_accessible_items::get_user_accessible_items(
            &ctx.db,
            user_id,
            Some("document".to_string()),
            should_exclude_owner,
        )
        .await
        .map_err(SearchError::InternalError)?
    };

    let document_ids: Vec<String> = document_ids_response
        .iter()
        .map(|a| a.item_id.clone())
        .collect();

    // If custom ids are provided or project_ids are provided, we will want to
    // explicitly search over the ids provided in opensearch
    let ids_only = !filters.document_ids.is_empty()
        || !filters.project_ids.is_empty()
        || !filters.owners.is_empty()
        || !filters.file_types.is_empty();

    // If project_ids are provided, we need to filter to ids that are within those projects
    // or sub-projects of those projects
    let document_ids = if !filters.project_ids.is_empty() {
        macro_db_client::items::filter::filter_items_by_project_ids(
            &ctx.db,
            &document_ids,
            ShareableItemType::Document,
            &filters.project_ids,
        )
        .await
        .map_err(SearchError::InternalError)?
    } else {
        document_ids
    };

    if document_ids.is_empty() && ids_only {
        return Ok(FilterDocumentResponse {
            document_ids: vec![],
            ids_only,
        });
    }

    let document_ids = if !filters.owners.is_empty() {
        macro_db_client::items::filter::filter_items_by_owner_ids(
            &ctx.db,
            &document_ids,
            ShareableItemType::Document,
            &filters.owners,
        )
        .await
        .map_err(SearchError::InternalError)?
    } else {
        document_ids
    };

    if document_ids.is_empty() && ids_only {
        return Ok(FilterDocumentResponse {
            document_ids: vec![],
            ids_only,
        });
    }

    let document_ids = if !filters.file_types.is_empty() {
        macro_db_client::items::filter::filter_documents_by_file_types(
            &ctx.db,
            &document_ids,
            &filters.file_types,
        )
        .await
        .map_err(SearchError::InternalError)?
    } else {
        document_ids
    };

    Ok(FilterDocumentResponse {
        document_ids,
        ids_only,
    })
}

/// Performs the name search over document names
#[tracing::instrument(skip(db), err)]
pub(in crate::api::search::simple) async fn search_names<'a>(
    db: &Pool<Postgres>,
    user_id: &MacroUserId<Lowercase<'a>>,
    filter_document_response: &FilterDocumentResponse,
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

    let document_uuids = filter_document_response
        .document_ids
        .iter()
        .map(|d| d.parse().unwrap())
        .collect::<Vec<Uuid>>();

    name_search::search_document_names(
        db,
        user_id,
        &document_uuids,
        term,
        filter_document_response.ids_only,
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
