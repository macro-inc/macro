//! Handler for `POST /documents/create_markdown`.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractor;
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::access_level::{AccessLevel, EditAccessLevel};

use super::DocumentRouterState;
use crate::domain::create::{MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument};
use crate::domain::models::{
    CreateMarkdownDocumentRequest, CreateMarkdownDocumentResponse, DocumentError,
};
use crate::domain::permission_token::encode_permission_token;
use crate::domain::ports::DocumentService;
use crate::domain::ports::create::DocumentCreationService;

/// Creates and initializes a markdown document in one backend-owned lifecycle.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/create_markdown",
    request_body = CreateMarkdownDocumentRequest,
    responses(
        (status = 200, body = inline(CreateMarkdownDocumentResponse)),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 409, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user_context, project), fields(user_id=?user_context.macro_user_id))]
pub async fn create_markdown_handler<
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
>(
    State(state): State<DocumentRouterState<T, Svc>>,
    user_context: MacroUserExtractor,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateMarkdownDocumentRequest, Svc>,
) -> Result<Json<CreateMarkdownDocumentResponse>, DocumentError> {
    let req = project.into_inner();

    let mut metadata = NewDocumentMetadata::builder(req.document_name);
    if let Some(project_id) = req.project_id {
        metadata = metadata.project_id(project_id);
    }
    if req.skip_history {
        metadata = metadata.skip_history();
    }

    let created = state
        .creator
        .create_markdown_text(
            user_context.macro_user_id.clone(),
            NewMarkdownTextDocument {
                metadata: metadata.build(),
                markdown: req.markdown.unwrap_or_default(),
                subtype: MarkdownSubtype::Note,
            },
        )
        .await?;

    let document_id = created.document_id().to_string();
    let document_metadata = created
        .response()
        .document_response
        .document_metadata
        .metadata
        .clone();

    let token = encode_permission_token(
        Some(user_context.macro_user_id.as_ref().to_string()),
        document_id.clone(),
        AccessLevel::Edit,
        &state.document_permission_jwt_secret,
    )
    .map_err(|e| {
        tracing::error!(error=?e, "failed to encode permission token");
        DocumentError::Internal(e.into())
    })?;

    Ok(Json(CreateMarkdownDocumentResponse {
        document_id,
        document_metadata,
        token,
    }))
}
