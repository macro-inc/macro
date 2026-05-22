//! Handler for `POST /documents/create_task`.

use axum::{Json, extract::State};
use entity_access::domain::models::MemberTeamRole;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{
    OptionalMacroUserTeamExtractor, ProjectBodyAccessLevelExtractor,
};
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::access_level::EditAccessLevel;

use super::DocumentRouterState;
use crate::domain::create::{MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument};
use crate::domain::models::{CreateTaskRequest, CreateTaskResponse, DocumentError};
use crate::domain::ports::DocumentService;
use crate::domain::ports::create::DocumentCreationService;

/// Creates a task document with properties and initialized markdown content in
/// one backend-owned lifecycle.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/create_task",
    request_body = CreateTaskRequest,
    responses(
        (status = 200, body = inline(CreateTaskResponse)),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user_context, optional_team, project), fields(user_id=?user_context.macro_user_id))]
pub async fn create_task_handler<
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
>(
    State(state): State<DocumentRouterState<T, Svc>>,
    user_context: MacroUserExtractor,
    optional_team: OptionalMacroUserTeamExtractor<MemberTeamRole, Svc>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateTaskRequest, Svc>,
) -> Result<Json<CreateTaskResponse>, DocumentError> {
    let req = project.into_inner();

    let mut metadata = NewDocumentMetadata::builder(req.task_name.clone());
    if let Some(project_id) = req.project_id {
        metadata = metadata.project_id(project_id);
    }

    let team_id = if req.share_with_team {
        optional_team
            .entity_access_receipt
            .map(|team| macro_uuid::string_to_uuid(&team.entity().entity_id).unwrap())
    } else {
        None
    };

    let created = state
        .creator
        .create_markdown_text(
            user_context.macro_user_id,
            NewMarkdownTextDocument {
                metadata: metadata.build(),
                markdown: req.markdown.unwrap_or_default(),
                subtype: MarkdownSubtype::Task {
                    property_values: req.property_values,
                    share_with_team: req.share_with_team && team_id.is_some(), // we should only try and share if the user is in a team and they have share_with_team set
                    team_id,
                },
            },
        )
        .await?;

    let task_metadata = &created.response().document_response.document_metadata;

    Ok(Json(CreateTaskResponse {
        document_id: created.document_id().to_string(),
        team_id: task_metadata.team_id,
        team_task_id: task_metadata.team_task_id,
    }))
}
