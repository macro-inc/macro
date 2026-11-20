//! Read a markdown document's blocks, and apply direct edits to them with no
//! model.
use super::DocumentRouterState;
use crate::domain::{
    markdown_edits::{
        DocumentMarkdownBlocks, MarkdownEditConflictReason, MarkdownEditError, MarkdownEditRefusal,
        MarkdownEditRequest, MarkdownEdited, edit_markdown, read_markdown_blocks,
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

/// Error code of a direct-edit request that did not complete.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MarkdownEditFailureCode {
    /// The batch was refused; `refusal` says why. Nothing was written.
    EditRefused,
    /// The batch conflicts with the document as it is now; `conflict` says
    /// why. Nothing was written.
    RevisionConflict,
    /// The blocks could not be read.
    ReadFailed,
    /// The batch failed after it was sent and may have applied.
    EditFailed,
}

/// Why a direct-edit request did not complete.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct MarkdownEditFailure {
    /// What went wrong.
    pub error: MarkdownEditFailureCode,
    /// What to do next.
    pub message: String,
    /// The refusal, for `edit_refused`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refusal: Option<MarkdownEditRefusal>,
    /// Why, for `revision_conflict`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<MarkdownEditConflictReason>,
}

impl IntoResponse for MarkdownEditError {
    fn into_response(self) -> Response {
        let (status, failure) = match self {
            MarkdownEditError::Document(error) => return error.into_response(),
            MarkdownEditError::Refused(refusal) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                MarkdownEditFailure {
                    error: MarkdownEditFailureCode::EditRefused,
                    message: refusal.message.clone(),
                    refusal: Some(refusal),
                    conflict: None,
                },
            ),
            MarkdownEditError::Conflict(conflict) => (
                StatusCode::CONFLICT,
                MarkdownEditFailure {
                    error: MarkdownEditFailureCode::RevisionConflict,
                    message: conflict.message,
                    refusal: None,
                    conflict: Some(conflict.reason),
                },
            ),
            MarkdownEditError::ReadFailed(error) => {
                tracing::error!(error = ?error, "document markdown blocks read failed");
                (
                    StatusCode::BAD_GATEWAY,
                    MarkdownEditFailure {
                        error: MarkdownEditFailureCode::ReadFailed,
                        message: "The document could not be read; retry.".to_owned(),
                        refusal: None,
                        conflict: None,
                    },
                )
            }
            MarkdownEditError::WriteFailed(error) => {
                tracing::error!(error = ?error, "document markdown edit failed");
                (
                    StatusCode::BAD_GATEWAY,
                    MarkdownEditFailure {
                        error: MarkdownEditFailureCode::EditFailed,
                        message: "The edit failed after it was sent and may have applied; read the document before retrying.".to_owned(),
                        refusal: None,
                        conflict: None,
                    },
                )
            }
        };
        (status, Json(failure)).into_response()
    }
}

/// Read a markdown document's or task's top-level blocks, each with its id and
/// internal markdown, and the revision they were read at: what direct edits
/// match against.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/markdown/blocks",
    operation_id = "get_document_markdown_blocks",
    params(("document_id" = String, Path, description = "Document identity")),
    responses(
        (status = 200, body = DocumentMarkdownBlocks),
        (status = 400, description = "Not a markdown document", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 502, description = "The blocks could not be read", body = MarkdownEditFailure)
    )
)]
pub async fn get_markdown_blocks_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
) -> Result<Json<DocumentMarkdownBlocks>, MarkdownEditError> {
    read_markdown_blocks(
        state.editing_worker.as_ref(),
        &state.document_permission_jwt_secret,
        access.entity_access_receipt,
        &document,
    )
    .await
    .map(Json)
}

/// Apply a batch of direct edits to a markdown document's or task's body, with
/// no model: exact `old`/`new` replacements and insert, delete and move by
/// block id. Edited blocks keep their ids and comments; the batch merges with
/// edits made since `baseRevision`. Applied whole or not at all.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/markdown/edits",
    operation_id = "edit_document_markdown",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = MarkdownEditRequest,
    responses(
        (status = 200, body = MarkdownEdited),
        (status = 400, description = "Not a markdown document, or an invalid batch", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 409, description = "Nothing was written. `conflict: changed`: an edit no longer applies to the document as it is now; read the blocks again and redo it. `conflict: busy`: others kept editing while it committed; retry the same batch as is", body = MarkdownEditFailure),
        (status = 422, description = "The batch was refused; nothing was written", body = MarkdownEditFailure),
        (status = 502, description = "The edit failed and may have applied. A batch with `baseRevision` is safe to resend (it answers `already_applied` if it committed); one without it is not: read the blocks first, or its inserts may land twice", body = MarkdownEditFailure)
    )
)]
pub async fn edit_markdown_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    body: Result<Json<MarkdownEditRequest>, JsonRejection>,
) -> Result<Json<MarkdownEdited>, MarkdownEditError> {
    let Json(request) =
        body.map_err(|rejection| DocumentError::BadRequest(rejection.body_text()))?;
    edit_markdown(
        state.editing_worker.as_ref(),
        &state.document_permission_jwt_secret,
        access.entity_access_receipt,
        &document,
        &request,
    )
    .await
    .map(Json)
}
