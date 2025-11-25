use crate::api::search::simple::{SearchError, simple_document::search_documents};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_opensearch::SearchEntityType;
use models_search::document::{
    DocumentSearchRequest, DocumentSearchResponse, DocumentSearchResponseItem,
    DocumentSearchResponseItemWithMetadata, DocumentSearchResult,
};
use opensearch_client::search::model::SearchGotoContent;
use std::collections::HashMap;

use crate::api::ApiContext;

use super::SearchPaginationParams;

/// Enriches document search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_documents(
    ctx: &ApiContext,
    user_id: &str,
    results: Vec<opensearch_client::search::model::SearchHit>,
) -> Result<Vec<DocumentSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<opensearch_client::search::model::SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == SearchEntityType::Documents)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }
    // Extract document IDs from results
    let document_ids: Vec<String> = results.iter().map(|r| r.entity_id.clone()).collect();

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
    let enriched_results =
        construct_search_result(results, document_histories).map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

/// Performs a search through documents and enriches the results with metadata
pub async fn search_documents_enriched(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: DocumentSearchRequest,
) -> Result<Vec<DocumentSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results = search_documents(ctx, user_id, query_params, req).await?;

    enrich_documents(ctx, user_id, opensearch_results).await
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
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    document_histories: HashMap<
        String,
        macro_db_client::document::get_document_history::DocumentHistoryInfo,
    >,
) -> anyhow::Result<Vec<DocumentSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits>
    let entity_id_hit_map: HashMap<String, Vec<DocumentSearchResult>> = search_results
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
        .fold(HashMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    tracing::trace!("entity_id_hit_map: {:?}", entity_id_hit_map);

    // now construct the search results
    let result: Vec<DocumentSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            if let Some(info) = document_histories.get(&entity_id) {
                let info = info.clone();
                let metadata = models_search::document::DocumentMetadata {
                    created_at: info.created_at.timestamp(),
                    updated_at: info.updated_at.timestamp(),
                    viewed_at: info.viewed_at.map(|a| a.timestamp()),
                    project_id: info.project_id.clone(),
                    deleted_at: info.deleted_at.map(|a| a.timestamp()),
                };
                Some(DocumentSearchResponseItemWithMetadata {
                    metadata: Some(metadata),
                    extra: DocumentSearchResponseItem {
                        id: entity_id.clone(),
                        name: info.file_name.clone(),
                        document_id: entity_id,
                        document_name: info.file_name,
                        owner_id: info.owner,
                        file_type: info.file_type,
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
