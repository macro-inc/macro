//! Read and commit a markdown document as Lexical state, with no model.
use super::DocumentRouterState;
use crate::domain::{
    lexical::{
        DocumentLexicalCommitRequest, DocumentLexicalCommitted, DocumentLexicalError,
        DocumentLexicalNodeConflict, DocumentLexicalState, commit_lexical, read_lexical,
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

/// Largest commit body: 500 top-level blocks of serialized Lexical JSON.
pub const MAX_LEXICAL_COMMIT_BODY_BYTES: usize = 16 * 1024 * 1024;

/// Error code of a commit that could not merge.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentLexicalConflictCode {
    /// At least one node could not merge with the live document.
    Conflict,
}

/// Nodes that could not merge with the live document; nothing was applied.
/// Read the document again and redo the change.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DocumentLexicalConflict {
    /// Always `conflict`.
    pub error: DocumentLexicalConflictCode,
    /// Each node that could not merge, and why.
    pub conflicts: Vec<DocumentLexicalNodeConflict>,
}

/// Error code of a malformed commit.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentLexicalInvalidCode {
    /// The blocks are malformed.
    Invalid,
}

/// The blocks are malformed: an unknown node type, duplicate or mismatched
/// ids, or an `after` outside the document. Nothing was applied.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DocumentLexicalInvalid {
    /// Always `invalid`.
    pub error: DocumentLexicalInvalidCode,
    /// What is wrong, for the program that built the blocks.
    pub message: String,
}

/// Error code of a commit whose outcome is unknown.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentLexicalOutcomeUnknownCode {
    /// The commit may or may not have applied.
    EditOutcomeUnknown,
}

/// The commit was sent but never acknowledged, so it may have applied. Read
/// the document before retrying.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DocumentLexicalOutcomeUnknown {
    /// Always `edit_outcome_unknown`.
    pub error: DocumentLexicalOutcomeUnknownCode,
    /// What the editing worker reported.
    pub message: String,
}

impl IntoResponse for DocumentLexicalError {
    fn into_response(self) -> Response {
        match self {
            DocumentLexicalError::Document(error) => error.into_response(),
            DocumentLexicalError::Conflict(conflicts) => (
                StatusCode::CONFLICT,
                Json(DocumentLexicalConflict {
                    error: DocumentLexicalConflictCode::Conflict,
                    conflicts,
                }),
            )
                .into_response(),
            DocumentLexicalError::Invalid(message) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(DocumentLexicalInvalid {
                    error: DocumentLexicalInvalidCode::Invalid,
                    message,
                }),
            )
                .into_response(),
            DocumentLexicalError::OutcomeUnknown(message) => (
                StatusCode::BAD_GATEWAY,
                Json(DocumentLexicalOutcomeUnknown {
                    error: DocumentLexicalOutcomeUnknownCode::EditOutcomeUnknown,
                    message,
                }),
            )
                .into_response(),
        }
    }
}

/// Read a markdown document or task as Lexical state with the caller's view
/// access, with the revision to commit against.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/lexical",
    operation_id = "get_document_lexical",
    params(("document_id" = String, Path, description = "Document identity")),
    responses(
        (status = 200, body = DocumentLexicalState),
        (status = 400, description = "Not a markdown document", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document view access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, description = "The document could not be read", body = model_error_response::ErrorResponse)
    )
)]
pub async fn get_lexical_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
) -> Result<Json<DocumentLexicalState>, DocumentError> {
    read_lexical(
        state.editing_worker.as_ref(),
        &state.document_permission_jwt_secret,
        access.entity_access_receipt,
        &document,
    )
    .await
    .map(Json)
}

/// Commit changed top-level blocks of a markdown document or task with the
/// caller's edit access. The worker merges them three-way against the
/// revision they were read at, keeping concurrent collaborators' edits, and
/// applies all or nothing. Retrying a commit that landed changes nothing.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/lexical",
    operation_id = "commit_document_lexical",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = DocumentLexicalCommitRequest,
    responses(
        (status = 200, body = DocumentLexicalCommitted),
        (status = 400, description = "Not a markdown document, more than 500 blocks, or a malformed body", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 409, description = "Nodes could not merge with the live document; nothing was applied", body = DocumentLexicalConflict),
        (status = 422, description = "The blocks are malformed; nothing was applied", body = DocumentLexicalInvalid),
        (status = 500, description = "The commit could not be sent; nothing was applied", body = model_error_response::ErrorResponse),
        (status = 502, description = "Outcome unknown: the commit may have applied", body = DocumentLexicalOutcomeUnknown)
    )
)]
pub async fn commit_lexical_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    body: Result<Json<DocumentLexicalCommitRequest>, JsonRejection>,
) -> Result<Json<DocumentLexicalCommitted>, DocumentLexicalError> {
    let Json(request) =
        body.map_err(|rejection| DocumentError::BadRequest(rejection.body_text()))?;
    commit_lexical(
        state.editing_worker.as_ref(),
        &state.document_permission_jwt_secret,
        access.entity_access_receipt,
        &document,
        &request,
    )
    .await
    .map(Json)
}
