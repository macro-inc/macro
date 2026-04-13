//! Handler for `POST /documents/{document_id}/copy`.

use axum::{
    Extension, Json,
    extract::{Path, Query, State},
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use model::document::{DocumentBasic, FileTypeExt};
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::access_level::ViewAccessLevel;

use super::{DocumentRouterState, Params};
use crate::domain::models::{
    CopyDocumentQueryParams, CopyDocumentRequest, CopyDocumentResponse, DocumentError,
};
use crate::domain::ports::DocumentService;

/// Handler for `POST /documents/{document_id}/copy`.
///
/// Copies an existing document, creating a new document with the same content.
/// Does not require re-uploading the document file.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/{document_id}/copy",
    operation_id = "copy_document",
    params(
        ("document_id" = String, Path, description = "Document ID"),
        ("version_id" = Option<i64>, Query, description = "The version id of the document to copy. Defaults to copying the latest version of the document.")
    ),
    request_body = CopyDocumentRequest,
    responses(
        (status = 200, body = CopyDocumentResponse),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access, user_context, document_context, req), fields(user_id=%user_context.macro_user_id, document_version_id=?params.version_id))]
pub async fn copy_document_handler<T: DocumentService, Svc: EntityAccessService>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    user_context: MacroUserExtractor,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Query(params): Query<CopyDocumentQueryParams>,
    Json(mut req): Json<CopyDocumentRequest>,
) -> Result<Json<CopyDocumentResponse>, DocumentError> {
    // Clean the document name (remove file extension if present)
    req.document_name = model::document::FileType::clean_document_name(&req.document_name)
        .unwrap_or(req.document_name);

    let response = state
        .service
        .copy_document(
            access.entity_access_receipt,
            document_context.0,
            user_context.macro_user_id,
            req.document_name,
            params.version_id,
            req.version_id,
        )
        .await?;

    Ok(Json(CopyDocumentResponse {
        error: false,
        data: response,
    }))
}
