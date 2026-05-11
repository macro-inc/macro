//! Handler for `GET /documents/{document_id}`.

use axum::{
    Extension, Json,
    extract::{Path, State},
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use model::user::UserContext;
use models_permissions::share_permission::access_level::ViewAccessLevel;

use super::{DocumentRouterState, Params};
use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;
use crate::domain::response::GetDocumentResponse;

/// Handler for `GET /documents/{document_id}`.
///
/// Returns document metadata, user access level, and view location.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}",
    operation_id = "get_document",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body = GetDocumentResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access), err)]
pub async fn get_document_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GetDocumentResponse>, DocumentError> {
    let response_data = state
        .service
        .get_document(access.entity_access_receipt)
        .await?;

    Ok(Json(GetDocumentResponse {
        error: false,
        data: response_data,
    }))
}
