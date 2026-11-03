//! Edit a markdown document by natural-language instructions, through the
//! same AI pipeline as the EditDocument tool.
use super::DocumentRouterState;
use crate::domain::{
    ai_edit::{DocumentAiEditError, DocumentAiEdited, edit_with_instructions},
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
    domain::{models::EditAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::DocumentAccessExtractor,
};
use macro_authorization::MacroAuthorizationService;
use model::document::DocumentBasic;

/// What to change, in words.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct DocumentAiEditRequest {
    /// Natural-language instructions. Name the section or quote the text to
    /// change, describe the outcome, and say what must stay as it is.
    #[schema(min_length = 1)]
    pub instructions: String,
    /// Run the single-model fast pipeline, for one small, contained edit.
    #[serde(default)]
    pub fast: bool,
}

/// Error code of an edit the editor refused.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentAiEditRefusedCode {
    /// The editor could not do the edit.
    EditRefused,
}

/// The editor could not do the edit; nothing changed.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DocumentAiEditRefused {
    /// Always `edit_refused`.
    pub error: DocumentAiEditRefusedCode,
    /// Why, in the editor's words: what it needs to know or cannot do.
    pub reason: String,
}

/// Error code of an edit that failed after it started.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentAiEditFailedCode {
    /// The edit failed and may have partly applied.
    EditFailed,
}

/// The edit failed after it started, so it may have partly applied. Read the
/// document before retrying.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DocumentAiEditFailed {
    /// Always `edit_failed`.
    pub error: DocumentAiEditFailedCode,
    /// What to do next; the cause is logged, never returned.
    pub message: String,
}

impl IntoResponse for DocumentAiEditError {
    fn into_response(self) -> Response {
        match self {
            DocumentAiEditError::Document(error) => error.into_response(),
            DocumentAiEditError::Admission(error) => error.into_response(),
            DocumentAiEditError::Refused(reason) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(DocumentAiEditRefused {
                    error: DocumentAiEditRefusedCode::EditRefused,
                    reason,
                }),
            )
                .into_response(),
            DocumentAiEditError::Failed(error) => {
                tracing::error!(error = ?error, "document ai edit failed");
                (
                    StatusCode::BAD_GATEWAY,
                    Json(DocumentAiEditFailed {
                        error: DocumentAiEditFailedCode::EditFailed,
                        message: "The edit failed after it started and may have partly applied; read the document before retrying.".to_string(),
                    }),
                )
                    .into_response()
            }
        }
    }
}

/// Edit a markdown document or task by instructions with the caller's edit
/// access. Runs EditDocument's pipeline as a live collaborator, with its AI
/// admission and billing.
///
/// A client that disconnects aborts the edit: axum drops this handler's
/// future, which drops the in-flight request to the editing worker, and the
/// worker aborts on its request signal. Steps already acknowledged stay.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/ai-edit",
    operation_id = "edit_document_with_ai",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = DocumentAiEditRequest,
    responses(
        (status = 200, body = DocumentAiEdited),
        (status = 400, description = "Not a markdown document, or empty instructions", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 402, description = "AI allowance exhausted", body = ai_billing::inbound::admission::AiAdmissionErrorBody),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 422, description = "The editor could not do the edit; nothing changed", body = DocumentAiEditRefused),
        (status = 500, description = "The edit could not start", body = model_error_response::ErrorResponse),
        (status = 502, description = "The edit failed and may have partly applied", body = DocumentAiEditFailed),
        (status = 503, description = "AI usage validation unavailable; retry later", body = ai_billing::inbound::admission::AiAdmissionErrorBody)
    )
)]
pub async fn ai_edit_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    body: Result<Json<DocumentAiEditRequest>, JsonRejection>,
) -> Result<Json<DocumentAiEdited>, DocumentAiEditError> {
    let Json(request) =
        body.map_err(|rejection| DocumentError::BadRequest(rejection.body_text()))?;
    edit_with_instructions(
        state.ai_editing.as_ref(),
        &state.document_permission_jwt_secret,
        access.entity_access_receipt,
        &document,
        &request.instructions,
        request.fast,
    )
    .await
    .map(Json)
}
