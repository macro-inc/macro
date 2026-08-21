//! Handler for `POST /documents/create_skill`.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractorV2;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use models_permissions::share_permission::access_level::EditAccessLevel;

use super::DocumentRouterState;
use crate::domain::create::{MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument};
use crate::domain::models::{CreateSkillRequest, CreateSkillResponse, DocumentError};
use crate::domain::ports::DocumentService;
use crate::domain::ports::create::DocumentCreationService;

/// Creates a skill document with initialized markdown content in one
/// backend-owned lifecycle. Skills are markdown documents containing
/// instructions that AI reads and follows when the skill is referenced in an
/// AI input.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/create_skill",
    request_body = CreateSkillRequest,
    responses(
        (status = 200, body = inline(CreateSkillResponse)),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user, project), fields(user_id=?user.authorization.user.macro_user_id))]
pub async fn create_skill_handler<
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    project: ProjectBodyAccessLevelExtractorV2<EditAccessLevel, CreateSkillRequest, Svc, Auth>,
) -> Result<Json<CreateSkillResponse>, DocumentError> {
    let req = project.into_inner();

    let mut metadata = NewDocumentMetadata::builder(req.skill_name);
    if let Some(project_id) = req.project_id {
        metadata = metadata.project_id(project_id);
    }

    let created = state
        .creator
        .create_markdown_text(
            user.authorization.user.macro_user_id.clone(),
            NewMarkdownTextDocument {
                metadata: metadata.build(),
                markdown: req.markdown.unwrap_or_default(),
                subtype: MarkdownSubtype::Skill,
            },
        )
        .await?;

    Ok(Json(CreateSkillResponse {
        document_id: created.document_id().to_string(),
    }))
}
