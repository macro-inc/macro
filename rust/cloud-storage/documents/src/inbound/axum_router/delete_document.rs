//! Handler for `DELETE /documents/:document_id`.

use axum::{
    Extension, Json,
    extract::{Path, State},
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use model::document::DocumentBasic;
use model::response::GenericSuccessResponse;
use model::user::UserContext;
use models_permissions::share_permission::access_level::OwnerAccessLevel;

use super::{DocumentRouterState, Params};
use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;

/// Handler for `DELETE /documents/:document_id`.
///
/// Soft-deletes a document (only owners can delete).
#[utoipa::path(
    tag = "document",
    delete,
    path = "/documents/{document_id}",
    operation_id = "delete_document",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body = GenericSuccessResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access, doc), err)]
pub async fn delete_document_handler<T: DocumentService, Svc: EntityAccessService>(
    access: DocumentAccessExtractor<OwnerAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    user_context: Extension<UserContext>,
    doc: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GenericSuccessResponse>, DocumentError> {
    tracing::info!("delete document");

    state
        .service
        .delete_document(access.entity_access_receipt, doc.project_id.clone())
        .await?;

    Ok(Json(GenericSuccessResponse { success: true }))
}
