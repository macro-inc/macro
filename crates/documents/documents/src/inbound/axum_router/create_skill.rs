//! Handler for `POST /documents/create_skill`.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractorV2;
use entity_registry::CreationPrincipalExtractor;
use macro_authorization::MacroAuthorizationService;
use permissions_types::share_permission::access_level::EditAccessLevel;

use super::DocumentRouterState;
use crate::domain::create::{MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument};
use crate::domain::models::{CreateSkillRequest, CreateSkillResponse, DocumentError};
use crate::domain::ports::DocumentService;
use crate::domain::ports::create::DocumentCreationService;
use crate::domain::skill_description::SkillDescription;

/// Creates a skill document with initialized markdown content and its
/// routing description in one backend-owned lifecycle. Skills are markdown documents containing
/// instructions that AI reads and follows when the skill is referenced in an
/// AI input.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/create_skill",
    request_body = CreateSkillRequest,
    responses(
        (status = 200, body = inline(CreateSkillResponse)),
        (status = 400, description = "The description is blank, longer than one line or 300 characters, or does not start \"Use when\"", body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, project))]
pub async fn create_skill_handler<
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    project: ProjectBodyAccessLevelExtractorV2<EditAccessLevel, CreateSkillRequest, Svc, Auth>,
) -> Result<Json<CreateSkillResponse>, DocumentError> {
    let req = project.into_inner();
    // Validate before creating, so a bad description creates nothing.
    let description = SkillDescription::parse(&req.description)?;

    let mut metadata = NewDocumentMetadata::builder(req.skill_name);
    if let Some(project_id) = req.project_id {
        metadata = metadata.project_id(project_id);
    }

    let created = state
        .creator
        .create_markdown_text(
            &principal,
            NewMarkdownTextDocument {
                metadata: metadata.build(),
                markdown: req.markdown.unwrap_or_default(),
                subtype: MarkdownSubtype::Skill,
            },
        )
        .await?;

    let document_id = created.document_id().to_string();
    state
        .service
        .describe_new_skill(&document_id, description)
        .await?;

    Ok(Json(CreateSkillResponse { document_id }))
}
