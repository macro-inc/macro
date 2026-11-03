//! Commit a batch of typed edit ops to a markdown document, with no model.
use super::DocumentRouterState;
use crate::domain::{
    document_edits::{DocumentEditError, DocumentEditsApplied, apply_operations},
    models::DocumentError,
    ports::{
        DocumentService,
        editing::{DocumentOp, DocumentOpFailure},
    },
};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::{
    domain::{models::EditAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::DocumentAccessExtractor,
};
use macro_authorization::MacroAuthorizationService;
use model::document::DocumentBasic;

/// A batch of edit ops built against the document's structure.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct DocumentEditsRequest {
    /// 1 to 200 ops, applied in order, all or nothing. Each is a `DocumentOp`
    /// from `@macro-inc/editor-ops`, the op vocabulary's source of truth.
    #[schema(value_type = Vec<Object>, min_items = 1, max_items = 200)]
    pub operations: Vec<DocumentOp>,
}

/// Error code of a refused batch.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentEditRejectedCode {
    /// At least one op failed against the live document.
    EditRejected,
}

/// Ops that failed against the live document; nothing was committed.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DocumentEditRejected {
    /// Always `edit_rejected`.
    pub error: DocumentEditRejectedCode,
    /// Each op that failed, by its index in the batch.
    pub failures: Vec<DocumentOpFailure>,
}

/// Error code of a batch whose outcome is unknown.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentEditUnacknowledgedCode {
    /// The edit was sent but never acknowledged.
    Unacknowledged,
}

/// The batch was sent to storage but never acknowledged, so it may have
/// applied. Read the document before retrying.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DocumentEditUnacknowledged {
    /// Always `unacknowledged`.
    pub error: DocumentEditUnacknowledgedCode,
    /// What the editing worker reported.
    pub message: String,
}

impl IntoResponse for DocumentEditError {
    fn into_response(self) -> Response {
        match self {
            DocumentEditError::Document(error) => error.into_response(),
            DocumentEditError::Rejected(failures) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(DocumentEditRejected {
                    error: DocumentEditRejectedCode::EditRejected,
                    failures,
                }),
            )
                .into_response(),
            DocumentEditError::Unacknowledged(message) => {
                tracing::warn!(%message, "document edit unacknowledged");
                (
                    StatusCode::BAD_GATEWAY,
                    Json(DocumentEditUnacknowledged {
                        error: DocumentEditUnacknowledgedCode::Unacknowledged,
                        message,
                    }),
                )
                    .into_response()
            }
        }
    }
}

/// Apply typed edit ops to a markdown document or task with the caller's edit
/// access. The batch merges with concurrent collaborators and commits all or
/// nothing.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/edits",
    operation_id = "apply_document_edits",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = DocumentEditsRequest,
    responses(
        (status = 200, body = DocumentEditsApplied),
        (status = 400, description = "Not a markdown document, or malformed ops", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 422, description = "Ops failed against the live document; nothing was committed", body = DocumentEditRejected),
        (status = 500, description = "Editing failed; nothing was committed", body = model_error_response::ErrorResponse),
        (status = 502, description = "Outcome unknown: the edit may have applied", body = DocumentEditUnacknowledged)
    )
)]
pub async fn apply_edits_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    body: Result<Json<DocumentEditsRequest>, JsonRejection>,
) -> Result<Json<DocumentEditsApplied>, DocumentEditError> {
    let Json(request) =
        body.map_err(|rejection| DocumentError::BadRequest(rejection.body_text()))?;
    apply_operations(
        state.editing_worker.as_ref(),
        &state.document_permission_jwt_secret,
        access.entity_access_receipt,
        &document,
        &request.operations,
    )
    .await
    .map(Json)
}
