//! Handler for `GET /documents/{document_id}/short_id`.

use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use models_permissions::share_permission::access_level::ViewAccessLevel;

use super::{DocumentRouterState, Params};
use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;

/// Short ID response.
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShortIdResponse {
    /// The short id of the document.
    short_id: String,
}

/// Handler for `GET /documents/{document_id}/short_id`.
///
/// Returns the short UUID for a document.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}/short_id",
    operation_id = "get_document_short_id",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body = String),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access), err)]
pub async fn get_short_id_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<ShortIdResponse>, DocumentError> {
    let short_id = state
        .service
        .get_short_id(access.entity_access_receipt)
        .await?;

    Ok(Json(ShortIdResponse { short_id }))
}
