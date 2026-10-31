//! MoveToTrash tool for deleting documents and projects to the trash.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::{MoveEntity, TrashEntity};
use model_entity::{Entity, EntityType};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::entity_receipts::{mutation_failed, user_receipt};
use super::{DocumentCapabilities, ProjectCapabilities, ProjectToolContext};

/// The kind of item to move to the trash.
#[derive(Debug, Deserialize, Serialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrashableEntityType {
    /// A document (includes tasks).
    Document,
    /// A project (folder), with everything inside it.
    Project,
}

impl TrashableEntityType {
    fn entity_type(self) -> EntityType {
        match self {
            Self::Document => EntityType::Document,
            Self::Project => EntityType::Project,
        }
    }
}

const TRASH_FORBIDDEN: &str = "only the owner of an item can move it to the trash";

/// Trash an entity through its domain capability, as the user.
async fn trash_with<S, ESvc>(
    service: &S,
    entity_access_service: &ESvc,
    request_context: &RequestContext,
    entity: Entity<'static>,
) -> ToolResult<()>
where
    S: TrashEntity,
    ESvc: EntityAccessService,
{
    let receipt =
        user_receipt::<S::Receipt, _>(entity_access_service, request_context, &entity).await?;
    service
        .trash_entity(entity, receipt)
        .await
        .map_err(mutation_failed("trash", TRASH_FORBIDDEN))?;
    Ok(())
}

/// The move to trash response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveToTrashResponse {
    /// The kind of item trashed.
    pub entity_type: TrashableEntityType,
    /// The trashed item's id.
    pub entity_id: uuid::Uuid,
    /// A human-readable result message.
    pub message: String,
}

/// MoveToTrash tool input.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "MoveToTrash",
    description = "Delete a document (including a task), or a project (folder) by moving it to the trash, as the Delete action in the app does. Trashing a project also trashes everything inside it. Only the item's owner can trash it. Use only when the user explicitly asks to delete an item. Channels, email threads, and calendar events are not deleted with this tool."
)]
pub struct MoveToTrash {
    /// The kind of item to trash.
    #[schemars(description = "The kind of item to move to the trash.")]
    pub entity_type: TrashableEntityType,

    /// The id of the item to trash.
    #[schemars(description = "The id of the item to move to the trash.")]
    pub entity_id: uuid::Uuid,
}

impl ToolAnnotated for MoveToTrash {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Move to trash").with_idempotent();
}

#[async_trait]
impl<PSvc, ESvc, DSvc, EmSvc> AsyncTool<ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>> for MoveToTrash
where
    PSvc: ProjectCapabilities,
    ESvc: EntityAccessService,
    DSvc: DocumentCapabilities,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    type Output = MoveToTrashResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, entity_type=?self.entity_type, entity_id=?self.entity_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let entity = self
            .entity_type
            .entity_type()
            .with_entity_string(self.entity_id.to_string());
        let access = &*service_context.entity_access_service;
        match self.entity_type {
            TrashableEntityType::Document => {
                trash_with(
                    &*service_context.document_move_service,
                    access,
                    &request_context,
                    entity,
                )
                .await?
            }
            TrashableEntityType::Project => {
                trash_with(&*service_context.service, access, &request_context, entity).await?
            }
        }

        Ok(MoveToTrashResponse {
            entity_type: self.entity_type,
            entity_id: self.entity_id,
            message: format!("Moved the {} to the trash.", self.entity_type.entity_type()),
        })
    }
}
