//! Handler for `POST /documents/create_snippet`.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractor;
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::access_level::EditAccessLevel;

use super::DocumentRouterState;
use crate::domain::create::{MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument};
use crate::domain::models::{CreateSnippetRequest, CreateSnippetResponse, DocumentError};
use crate::domain::ports::DocumentService;
use crate::domain::ports::create::DocumentCreationService;

/// Creates a snippet document with initialized markdown content in one
/// backend-owned lifecycle. Snippets are created personal; team sharing is
/// toggled separately via `PUT /documents/{document_id}/team_share`.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/create_snippet",
    request_body = CreateSnippetRequest,
    responses(
        (status = 200, body = inline(CreateSnippetResponse)),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user_context, project), fields(user_id=?user_context.macro_user_id))]
pub async fn create_snippet_handler<
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
>(
    State(state): State<DocumentRouterState<T, Svc>>,
    user_context: MacroUserExtractor,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateSnippetRequest, Svc>,
) -> Result<Json<CreateSnippetResponse>, DocumentError> {
    let req = project.into_inner();

    let mut metadata = NewDocumentMetadata::builder(req.snippet_name);
    if let Some(project_id) = req.project_id {
        metadata = metadata.project_id(project_id);
    }

    let created = state
        .creator
        .create_markdown_text(
            user_context.macro_user_id,
            NewMarkdownTextDocument {
                metadata: metadata.build(),
                markdown: req.markdown.unwrap_or_default(),
                subtype: MarkdownSubtype::Snippet,
            },
        )
        .await?;

    Ok(Json(CreateSnippetResponse {
        document_id: created.document_id().to_string(),
    }))
}
