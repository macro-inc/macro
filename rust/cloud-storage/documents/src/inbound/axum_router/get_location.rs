//! Handler for `GET /documents/:document_id/location_v3`.

use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use model::document::DocumentBasic;
use model::document::response::LocationResponseV3;
use models_permissions::share_permission::access_level::ViewAccessLevel;

use super::{DocumentRouterState, Params};
use crate::domain::models::{DocumentError, LocationQueryParams};
use crate::domain::ports::DocumentService;

/// Handler for `GET /documents/:document_id/location_v3`.
///
/// Returns a presigned URL or sync service content for accessing the document.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}/location_v3",
    operation_id = "get_document_location_v3",
    params(
        ("document_id" = String, Path, description = "Document ID"),
        ("document_version_id" = Option<i64>, Query, description = "A specific document version id to get the location for."),
        ("get_converted_docx_url" = Option<bool>, Query, description = "If true, this will return the converted docx url.")
    ),
    responses(
        (status = 200),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 410, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access, document_context), err)]
pub async fn get_location_v3_handler<T: DocumentService, Svc: EntityAccessService>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    Extension(document_context): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Query(params): Query<LocationQueryParams>,
) -> Result<(HeaderMap, Json<LocationResponseV3>), DocumentError> {
    let response_data = state
        .service
        .get_document_location(&document_context, access.entity_access_receipt, params)
        .await?;

    let mut header_map = HeaderMap::new();
    header_map.append("content-type", "application/json".parse().unwrap());
    header_map.append("Cache-Control", "max-age-300".parse().unwrap());

    Ok((header_map, Json(response_data)))
}
