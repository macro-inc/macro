//! MoveToProject tool for moving entities into and out of projects (folders).

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use bot_id::BotId;
use entity_access::domain::models::{
    AccessError, BotAccessScope, EditAccessLevel, EntityAccessReceipt, RequiredPermission,
};
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::{EntityMutationErrorCode, MoveEntity, capability::MoveEntityRequest};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ProjectToolContext;
use crate::domain::ports::ProjectService;

/// The kind of entity to move.
#[derive(Debug, Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MoveableEntityType {
    /// A document (includes tasks).
    #[default]
    Document,
    /// An AI chat conversation.
    Chat,
    /// An email thread.
    Email,
    /// A project (folder) nested into another project.
    Project,
}

impl MoveableEntityType {
    fn entity_type(self) -> EntityType {
        match self {
            Self::Document => EntityType::Document,
            Self::Chat => EntityType::Chat,
            Self::Email => EntityType::EmailThread,
            Self::Project => EntityType::Project,
        }
    }
}

fn entity_access_failed(error: AccessError) -> ToolCallError {
    ToolCallError {
        description:
            "you do not have the access required to move this entity, or it does not exist"
                .to_string(),
        internal_error: error.into(),
    }
}

fn project_access_failed(error: AccessError) -> ToolCallError {
    ToolCallError {
        description: "you do not have edit access to the destination project, or it does not exist"
            .to_string(),
        internal_error: error.into(),
    }
}

fn move_failed(code: EntityMutationErrorCode) -> ToolCallError {
    let description = match code {
        EntityMutationErrorCode::Forbidden(_) => {
            "you lack the required access: moving an AI chat or project requires owning it, moving a document or email thread requires edit access, and the destination project requires edit access"
        }
        EntityMutationErrorCode::NotFound(_) => "the entity or destination project was not found",
        EntityMutationErrorCode::Conflict(_) => {
            "the entity cannot be moved in its current state (it may be deleted)"
        }
        EntityMutationErrorCode::InvalidInput(_) => {
            "invalid move: a project cannot be moved into itself or one of its descendants"
        }
        EntityMutationErrorCode::UnsupportedOperation(_) => "this entity kind cannot be moved",
        EntityMutationErrorCode::Internal(_) => "failed to move the entity",
    };

    ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::anyhow!("move entity failed: {code:?}"),
    }
}

/// Whose receipts a move is minted with.
///
/// Documents publish bot attribution from the tool actor's receipt. Chat
/// `patch`, project lifecycle events, and email `thread_project_changed` still
/// require an authenticated user, so those moves stay user-scoped.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MovePrincipal {
    Bot(BotId),
    User,
}

impl MovePrincipal {
    fn for_entity(actor: BotId, entity_type: EntityType) -> Self {
        match entity_type {
            EntityType::Document => Self::Bot(actor),
            _ => Self::User,
        }
    }

    async fn receipt<T, ESvc>(
        self,
        entity_access_service: &ESvc,
        user_id: &MacroUserIdStr<'static>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError>
    where
        T: RequiredPermission,
        ESvc: EntityAccessService,
    {
        match self {
            Self::Bot(actor) => {
                entity_access_service
                    .generate_bot_entity_access_receipt::<T>(
                        actor,
                        BotAccessScope::user(user_id.clone()),
                        entity_id,
                        entity_type,
                    )
                    .await
            }
            Self::User => {
                entity_access_service
                    .generate_entity_access_receipt::<T>(user_id, None, entity_id, entity_type)
                    .await
            }
        }
    }
}

/// Mint the receipts a domain's move capability requires and dispatch to it,
/// mirroring the DSS entity-mutation router.
async fn move_with<S, ESvc>(
    service: &S,
    entity_access_service: &ESvc,
    actor: BotId,
    user_id: &MacroUserIdStr<'static>,
    entity: Entity<'static>,
    project_id: Option<String>,
) -> Result<(), ToolCallError>
where
    S: MoveEntity,
    ESvc: EntityAccessService,
{
    let principal = MovePrincipal::for_entity(actor, entity.entity_type);
    let receipt = principal
        .receipt::<S::Receipt, _>(
            entity_access_service,
            user_id,
            &entity.entity_id,
            entity.entity_type,
        )
        .await
        .map_err(entity_access_failed)?;

    let request = match project_id {
        Some(project_id) => {
            let project_receipt = principal
                .receipt::<EditAccessLevel, _>(
                    entity_access_service,
                    user_id,
                    &project_id,
                    EntityType::Project,
                )
                .await
                .map_err(project_access_failed)?;
            MoveEntityRequest::MoveToProject {
                entity,
                receipt,
                project_id,
                project_receipt,
            }
        }
        None => MoveEntityRequest::MoveToRoot { entity, receipt },
    };

    service.move_entity(request).await.map_err(move_failed)?;
    Ok(())
}

/// The move to project response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveToProjectResponse {
    /// Whether the move succeeded.
    pub success: bool,
    /// A human-readable result message.
    pub message: String,
}

/// MoveToProject tool input.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "MoveToProject",
    description = "Move a document, AI chat, email thread, or project into another project (projects are shown as folders in the app UI), or move it out to the top level. Requires edit access to the destination project. Moving a document or email thread requires edit access to it; moving an AI chat or a project requires owning it."
)]
pub struct MoveToProject {
    /// The kind of entity to move.
    #[schemars(description = "The kind of entity to move.")]
    pub entity_type: MoveableEntityType,

    /// The id of the entity to move.
    #[schemars(description = "The id of the entity to move.")]
    pub entity_id: uuid::Uuid,

    /// The destination project, or `None` for the top level.
    #[schemars(
        description = "The id of the destination project. Omit to move the entity out of its current project to the top level."
    )]
    #[serde(default)]
    pub project_id: Option<uuid::Uuid>,
}

impl ToolAnnotated for MoveToProject {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Move to project");
}

#[async_trait]
impl<PSvc, ESvc, DSvc, CSvc, EmSvc> AsyncTool<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>
    for MoveToProject
where
    PSvc: ProjectService + MoveEntity,
    ESvc: EntityAccessService,
    DSvc: MoveEntity + Send + Sync + 'static,
    CSvc: MoveEntity + Send + Sync + 'static,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    type Output = MoveToProjectResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, entity_type=?self.entity_type, entity_id=?self.entity_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Move to project");

        let user_id = request_context.user_id.clone();
        let entity = self
            .entity_type
            .entity_type()
            .with_entity_string(self.entity_id.to_string());
        let project_id = self.project_id.map(|id| id.to_string());

        let entity_access_service = &*service_context.entity_access_service;
        let actor = service_context.actor;
        match self.entity_type {
            MoveableEntityType::Document => {
                move_with(
                    &*service_context.document_move_service,
                    entity_access_service,
                    actor,
                    &user_id,
                    entity,
                    project_id,
                )
                .await?
            }
            MoveableEntityType::Chat => {
                move_with(
                    &*service_context.chat_move_service,
                    entity_access_service,
                    actor,
                    &user_id,
                    entity,
                    project_id,
                )
                .await?
            }
            MoveableEntityType::Email => {
                move_with(
                    &*service_context.email_move_service,
                    entity_access_service,
                    actor,
                    &user_id,
                    entity,
                    project_id,
                )
                .await?
            }
            MoveableEntityType::Project => {
                move_with(
                    &*service_context.service,
                    entity_access_service,
                    actor,
                    &user_id,
                    entity,
                    project_id,
                )
                .await?
            }
        }

        let message = match self.project_id {
            Some(project_id) => format!("Moved to project {project_id}"),
            None => "Moved out of its project to the top level".to_string(),
        };

        Ok(MoveToProjectResponse {
            success: true,
            message,
        })
    }
}
