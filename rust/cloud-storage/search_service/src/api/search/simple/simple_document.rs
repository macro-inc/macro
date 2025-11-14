use crate::api::search::{SearchPaginationParams, simple::SearchError};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{
    item::{ShareableItem, ShareableItemType},
    response::ErrorResponse,
    user::UserContext,
};
use models_search::document::{DocumentSearchRequest, SimpleDocumentSearchResponse};
use opensearch_client::search::documents::DocumentSearchArgs;

use crate::api::ApiContext;

/// Perform a search through your documents
/// This is a simple search where we do not group yor results by document id.
#[utoipa::path(
        post,
        path = "/search/simple/document",
        operation_id = "simple_document_search",
        params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=SimpleDocumentSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<DocumentSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("simple_document_search");

    let results = search_documents(&ctx, user_context.user_id.as_str(), &query_params, req).await?;

    Ok((
        StatusCode::OK,
        Json(SimpleDocumentSearchResponse {
            results: results.into_iter().map(|a| a.into()).collect(),
        }),
    )
        .into_response())
}

/// Performs a search through your documents and returns the raw opensearch results
pub(in crate::api::search) async fn search_documents(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: DocumentSearchRequest,
) -> Result<Vec<opensearch_client::search::documents::DocumentSearchResponse>, SearchError> {
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

    let terms: Vec<String> = if let Some(terms) = req.terms.as_ref() {
        terms
            .iter()
            .filter_map(|t| if t.len() < 3 { None } else { Some(t.clone()) })
            .collect()
    } else if let Some(query) = req.query.as_ref() {
        if query.len() < 3 {
            return Err(SearchError::InvalidQuerySize);
        }

        vec![query.clone()]
    } else {
        return Err(SearchError::NoQueryOrTermsProvided);
    };

    let filters = req.filters.unwrap_or_default();

    let document_ids_response = if !filters.document_ids.is_empty() {
        // Item ids are provided, we want to get the list of those that are accessible to the user
        ctx.dss_client
            .validate_user_accessible_item_ids(
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
        ctx.dss_client
            .get_user_accessible_item_ids(
                user_id,
                Some("document".to_string()),
                Some(should_exclude_owner),
            )
            .await
            .map_err(SearchError::InternalError)?
            .items
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
        return Ok(Vec::new());
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
        return Ok(Vec::new());
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

    if document_ids.is_empty() && ids_only {
        return Ok(Vec::new());
    }

    let results = ctx
        .opensearch_client
        .search_documents(DocumentSearchArgs {
            terms,
            user_id: user_id.to_string(),
            document_ids,
            page,
            page_size,
            match_type: req.match_type.to_string(),
            search_on: req.search_on.into(),
            collapse: req.collapse.unwrap_or(false),
            ids_only,
            disable_recency: req.disable_recency,
        })
        .await
        .map_err(SearchError::Search)?;

    Ok(results)
}
