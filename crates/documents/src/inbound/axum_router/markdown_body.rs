//! Read a markdown document's body with its revision, and replace it only at
//! that revision.
use super::DocumentRouterState;
use crate::domain::{
    markdown_body::{
        DocumentMarkdown, DocumentMarkdownError, DocumentMarkdownWritten, read_markdown,
        write_markdown,
    },
    models::DocumentError,
    ports::DocumentService,
};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::{
    domain::{
        models::{EditAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::DocumentAccessExtractor,
};
use macro_authorization::MacroAuthorizationService;
use model::document::DocumentBasic;

/// The body to write and the revision it was written against.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteDocumentMarkdownRequest {
    /// The whole new body, as Markdown.
    pub markdown: String,
    /// The `revision` from the read this body is based on. The write applies
    /// only if the document is still at this revision.
    #[schema(min_length = 1)]
    pub expected_revision: String,
}

/// Error code of a body read or write that did not complete.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentMarkdownFailureCode {
    /// The document changed since the caller read it; nothing was written.
    RevisionConflict,
    /// The body could not be read.
    ReadFailed,
    /// The write failed after it was sent and may have applied.
    WriteFailed,
}

/// Why a body read or write did not complete.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DocumentMarkdownFailure {
    /// What went wrong.
    pub error: DocumentMarkdownFailureCode,
    /// What to do next; the cause is logged, never returned.
    pub message: String,
}

impl IntoResponse for DocumentMarkdownError {
    fn into_response(self) -> Response {
        let (status, error, message) = match self {
            DocumentMarkdownError::Document(error) => return error.into_response(),
            DocumentMarkdownError::Conflict => (
                StatusCode::CONFLICT,
                DocumentMarkdownFailureCode::RevisionConflict,
                "The document changed since it was read; nothing was written. Read it again and write against the new revision.",
            ),
            DocumentMarkdownError::ReadFailed(error) => {
                tracing::error!(error = ?error, "document markdown read failed");
                (
                    StatusCode::BAD_GATEWAY,
                    DocumentMarkdownFailureCode::ReadFailed,
                    "The document could not be read; retry.",
                )
            }
            DocumentMarkdownError::WriteFailed(error) => {
                tracing::error!(error = ?error, "document markdown write failed");
                (
                    StatusCode::BAD_GATEWAY,
                    DocumentMarkdownFailureCode::WriteFailed,
                    "The write failed after it was sent and may have applied; read the document before retrying.",
                )
            }
        };
        (
            status,
            Json(DocumentMarkdownFailure {
                error,
                message: message.to_string(),
            }),
        )
            .into_response()
    }
}

/// Read a markdown document's or task's body with the revision it was read
/// at, to write it back with `PUT` without overwriting anyone's edits.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/markdown",
    operation_id = "get_document_markdown",
    params(("document_id" = String, Path, description = "Document identity")),
    responses(
        (status = 200, body = DocumentMarkdown),
        (status = 400, description = "Not a markdown document", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 502, description = "The body could not be read", body = DocumentMarkdownFailure)
    )
)]
pub async fn get_markdown_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
) -> Result<Json<DocumentMarkdown>, DocumentMarkdownError> {
    read_markdown(
        state.editing_worker.as_ref(),
        &state.document_permission_jwt_secret,
        access.entity_access_receipt,
        &document,
    )
    .await
    .map(Json)
}

/// Replace a markdown document's or task's body, only if the document is still
/// at the revision the caller read. Top-level blocks whose Markdown is
/// unchanged keep their comments and formatting; changed blocks are replaced.
#[utoipa::path(
    put,
    tag = "document",
    path = "/documents/{document_id}/markdown",
    operation_id = "write_document_markdown",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = WriteDocumentMarkdownRequest,
    responses(
        (status = 200, body = DocumentMarkdownWritten),
        (status = 400, description = "Not a markdown document, or an empty revision", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 409, description = "The document changed since the revision was read; nothing was written", body = DocumentMarkdownFailure),
        (status = 502, description = "The write failed and may have applied", body = DocumentMarkdownFailure)
    )
)]
pub async fn write_markdown_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    body: Result<Json<WriteDocumentMarkdownRequest>, JsonRejection>,
) -> Result<Json<DocumentMarkdownWritten>, DocumentMarkdownError> {
    let Json(request) =
        body.map_err(|rejection| DocumentError::BadRequest(rejection.body_text()))?;
    write_markdown(
        state.editing_worker.as_ref(),
        &state.document_permission_jwt_secret,
        access.entity_access_receipt,
        &document,
        &request.expected_revision,
        &request.markdown,
    )
    .await
    .map(Json)
}
