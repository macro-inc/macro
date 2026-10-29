//! DuplicateItem tool for copying documents.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::{DuplicateEntity, EntityMutationEffect, MoveEntity};
use model_entity::{Entity, EntityType};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::entity_receipts::{first_updated, mutation_failed, user_receipt};
use super::{DocumentCapabilities, ProjectCapabilities, ProjectToolContext};

/// The kind of item to duplicate.
#[derive(Debug, Deserialize, Serialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DuplicableEntityType {
    /// A document (includes tasks).
    Document,
}

impl DuplicableEntityType {
    fn entity_type(self) -> EntityType {
        match self {
            Self::Document => EntityType::Document,
        }
    }
}

const DUPLICATE_FORBIDDEN: &str = "you need at least view access to an item to duplicate it";

/// Duplicate an entity through its domain capability, as the user.
async fn duplicate_with<S, ESvc>(
    service: &S,
    entity_access_service: &ESvc,
    request_context: &RequestContext,
    entity: Entity<'static>,
    name: Option<String>,
) -> ToolResult<Vec<EntityMutationEffect>>
where
    S: DuplicateEntity,
    ESvc: EntityAccessService,
{
    let receipt =
        user_receipt::<S::Receipt, _>(entity_access_service, request_context, &entity).await?;
    service
        .duplicate_entity(entity, receipt, request_context.user_id.clone(), name)
        .await
        .map_err(mutation_failed("duplicate", DUPLICATE_FORBIDDEN))
}

/// The duplicate item response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateItemResponse {
    /// The kind of item duplicated.
    pub entity_type: DuplicableEntityType,
    /// The id of the original item.
    pub source_id: uuid::Uuid,
    /// The id of the new copy.
    pub copy_id: String,
    /// A human-readable result message.
    pub message: String,
}

/// DuplicateItem tool input.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DuplicateItem",
    description = "Make a copy of a document (including a task), owned by the user, as the Duplicate action in the app does. Requires view access to the original. Returns the copy's id."
)]
pub struct DuplicateItem {
    /// The kind of item to duplicate.
    #[schemars(description = "The kind of item to duplicate.")]
    pub entity_type: DuplicableEntityType,

    /// The id of the item to duplicate.
    #[schemars(description = "The id of the item to duplicate.")]
    pub entity_id: uuid::Uuid,

    /// Optional name for the copy.
    #[schemars(
        description = "Name for the copy of a document. Omit to use \"<original name> copy\"."
    )]
    #[serde(default)]
    pub name: Option<String>,
}

impl ToolAnnotated for DuplicateItem {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Duplicate");
}

#[async_trait]
impl<PSvc, ESvc, DSvc, EmSvc> AsyncTool<ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>
    for DuplicateItem
where
    PSvc: ProjectCapabilities,
    ESvc: EntityAccessService,
    DSvc: DocumentCapabilities,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    type Output = DuplicateItemResponse;

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
        let name = self
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string);
        let access = &*service_context.entity_access_service;
        let effects = match self.entity_type {
            DuplicableEntityType::Document => {
                duplicate_with(
                    &*service_context.document_move_service,
                    access,
                    &request_context,
                    entity,
                    name,
                )
                .await?
            }
        };
        let copy_id = first_updated(&effects)
            .map(|copy| copy.entity_id.to_string())
            .ok_or_else(|| ToolCallError {
                description: "the item was duplicated but its copy could not be identified"
                    .to_string(),
                internal_error: anyhow::anyhow!("duplicate returned no updated entity"),
            })?;

        Ok(DuplicateItemResponse {
            entity_type: self.entity_type,
            source_id: self.entity_id,
            message: format!(
                "Duplicated the {} as {copy_id}.",
                self.entity_type.entity_type()
            ),
            copy_id,
        })
    }
}
