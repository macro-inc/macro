//! RenameItem tool for renaming projects (folders) and AI chats.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::{MoveEntity, RenameEntity};
use model_entity::{Entity, EntityType};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::entity_receipts::{mutation_failed, user_receipt};
use super::{ChatCapabilities, DocumentCapabilities, ProjectCapabilities, ProjectToolContext};

/// The kind of item to rename.
#[derive(Debug, Deserialize, Serialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RenameableEntityType {
    /// A project (folder).
    Project,
    /// An AI chat conversation.
    Chat,
}

impl RenameableEntityType {
    fn entity_type(self) -> EntityType {
        match self {
            Self::Project => EntityType::Project,
            Self::Chat => EntityType::Chat,
        }
    }
}

const RENAME_FORBIDDEN: &str =
    "renaming a project requires edit access and renaming an AI chat requires owning it";

/// Rename an entity through its domain capability, as the user.
async fn rename_with<S, ESvc>(
    service: &S,
    entity_access_service: &ESvc,
    request_context: &RequestContext,
    entity: Entity<'static>,
    name: String,
) -> ToolResult<()>
where
    S: RenameEntity,
    ESvc: EntityAccessService,
{
    let receipt =
        user_receipt::<S::Receipt, _>(entity_access_service, request_context, &entity).await?;
    service
        .rename_entity(entity, receipt, name)
        .await
        .map_err(mutation_failed("rename", RENAME_FORBIDDEN))?;
    Ok(())
}

/// The rename item response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenameItemResponse {
    /// The kind of item renamed.
    pub entity_type: RenameableEntityType,
    /// The renamed item's id.
    pub entity_id: uuid::Uuid,
    /// The new name.
    pub name: String,
}

/// RenameItem tool input.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "RenameItem",
    description = "Rename a project (shown as a folder in the app) or an AI chat. Renaming a project requires edit access; renaming an AI chat requires owning it. Use RenameDocument for documents and tasks, and RenameChannel for channels."
)]
pub struct RenameItem {
    /// The kind of item to rename.
    #[schemars(description = "The kind of item to rename.")]
    pub entity_type: RenameableEntityType,

    /// The id of the item to rename.
    #[schemars(description = "The id of the item to rename.")]
    pub entity_id: uuid::Uuid,

    /// The new name.
    #[schemars(description = "The new name.")]
    pub name: String,
}

impl ToolAnnotated for RenameItem {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Rename").with_idempotent();
}

#[async_trait]
impl<PSvc, ESvc, DSvc, CSvc, EmSvc> AsyncTool<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>
    for RenameItem
where
    PSvc: ProjectCapabilities,
    ESvc: EntityAccessService,
    DSvc: DocumentCapabilities,
    CSvc: ChatCapabilities,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    type Output = RenameItemResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, entity_type=?self.entity_type, entity_id=?self.entity_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let name = self.name.trim().to_string();
        if name.is_empty() {
            return Err(ToolCallError {
                description: "name must not be empty".to_string(),
                internal_error: anyhow::anyhow!("empty rename"),
            });
        }
        let entity = self
            .entity_type
            .entity_type()
            .with_entity_string(self.entity_id.to_string());
        let access = &*service_context.entity_access_service;
        match self.entity_type {
            RenameableEntityType::Project => {
                rename_with(
                    &*service_context.service,
                    access,
                    &request_context,
                    entity,
                    name.clone(),
                )
                .await?
            }
            RenameableEntityType::Chat => {
                rename_with(
                    &*service_context.chat_move_service,
                    access,
                    &request_context,
                    entity,
                    name.clone(),
                )
                .await?
            }
        }

        Ok(RenameItemResponse {
            entity_type: self.entity_type,
            entity_id: self.entity_id,
            name,
        })
    }
}
