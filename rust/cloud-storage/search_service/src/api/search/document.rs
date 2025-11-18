use crate::{
    api::search::simple::{SearchError, simple_document::search_documents},
    model::DocumentOpenSearchResponse,
};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::document::{
    DocumentSearchMetadata, DocumentSearchRequest, DocumentSearchResponse,
    DocumentSearchResponseItem, DocumentSearchResponseItemWithMetadata, DocumentSearchResult,
};
use std::collections::HashMap;

use crate::{api::ApiContext, util};

use super::SearchPaginationParams;

/// Performs a search through documents and enriches the results with metadata
pub async fn search_documents_enriched(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: DocumentSearchRequest,
) -> Result<Vec<DocumentSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results = search_documents(ctx, user_id, query_params, req).await?;

    // Extract document IDs from results
    let document_ids: Vec<String> = opensearch_results
        .iter()
        .map(|r| r.document_id.clone())
        .collect();

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
    let enriched_results = construct_search_result(opensearch_results, document_histories)
        .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

/// Perform a search through your documents
#[utoipa::path(
        post,
        path = "/search/document",
        operation_id = "document_search",
        params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=DocumentSearchResponse),
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
    let user_id = user_context.user_id.as_str();

    let results = search_documents_enriched(&ctx, user_id, &query_params, req).await?;

    let result = DocumentSearchResponse { results };

    Ok((StatusCode::OK, Json(result)).into_response())
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::documents::DocumentSearchResponse>,
    document_histories: HashMap<
        String,
        macro_db_client::document::get_document_history::DocumentHistoryInfo,
    >,
) -> anyhow::Result<Vec<DocumentSearchResponseItemWithMetadata>> {
    let search_results = search_results
        .into_iter()
        .map(|inner| DocumentOpenSearchResponse { inner })
        .collect();
    let result = util::construct_search_result::<
        DocumentOpenSearchResponse,
        DocumentSearchResult,
        DocumentSearchMetadata,
    >(search_results)?;
    // To preserve backwards compatibility for now, convert back into old struct
    let result: Vec<DocumentSearchResponseItem> = result.into_iter().map(|a| a.into()).collect();

    // Add metadata for each document, fetched from macrodb
    let result: Vec<DocumentSearchResponseItemWithMetadata> = result
        .into_iter()
        .map(|item| {
            let metadata = document_histories.get(&item.document_id).map(|info| {
                models_search::document::DocumentMetadata {
                    created_at: info.created_at.timestamp(),
                    updated_at: info.updated_at.timestamp(),
                    viewed_at: info.viewed_at.map(|a| a.timestamp()),
                    project_id: info.project_id.clone(),
                    deleted_at: info.deleted_at.map(|a| a.timestamp()),
                }
            });

            DocumentSearchResponseItemWithMetadata {
                metadata,
                extra: item,
            }
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod test;
