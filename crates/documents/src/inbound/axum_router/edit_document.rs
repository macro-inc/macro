//! Handler for `PATCH /documents/{document_id}`.

use axum::{
    Extension, Json,
    extract::{Path, State},
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{
    DocumentAccessExtractor, ProjectBodyAccessLevelExtractor,
};
use model::document::DocumentBasic;
use model::response::GenericSuccessResponse;
use models_permissions::share_permission::access_level::EditAccessLevel;

use super::{DocumentRouterState, Params};
use crate::domain::models::{DocumentError, EditDocumentServiceArgs};
use crate::domain::ports::DocumentService;

/// Edit document response.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct EditDocumentResponse {
    /// Whether an error occurred.
    pub error: bool,
    /// The response data.
    pub data: GenericSuccessResponse,
}

/// Handler for `PATCH /documents/{document_id}`.
///
/// Edits document metadata such as name or project, and modifies
/// the document's share permissions. Requires edit access to the document,
/// and edit access to the target project if moving the document.
#[utoipa::path(
    tag = "document",
    patch,
    path = "/documents/{document_id}",
    operation_id = "edit_document",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    request_body = EditDocumentServiceArgs,
    responses(
        (status = 200, body = EditDocumentResponse),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access, doc, project), err)]
pub async fn edit_document_handler<T: DocumentService, Svc: EntityAccessService>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    doc: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, EditDocumentServiceArgs, Svc>,
) -> Result<Json<EditDocumentResponse>, DocumentError> {
    if doc.deleted_at.is_some() {
        return Err(DocumentError::BadRequest(
            "cannot modify deleted document".to_string(),
        ));
    }

    let args = project.into_inner();

    state
        .service
        .edit_document(access.entity_access_receipt, doc.0, args)
        .await?;

    Ok(Json(EditDocumentResponse {
        error: false,
        data: GenericSuccessResponse::default(),
    }))
}
