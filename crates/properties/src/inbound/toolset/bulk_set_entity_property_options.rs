//! BulkSetEntityPropertyOptions tool: apply one option delta (e.g. a tag) to
//! many entities in a single call.

use crate::domain::model::{EditReceipt, EntityOptionUpdateOutcome};
use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::models::{BotAccessScope, EditAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::PropertiesToolContext;
use super::get_entity_properties::ToolPropertyTargetEntityType;

/// The most entities one call may target. Mirrors the HTTP endpoint's cap.
const MAX_BULK_ENTITIES: usize = 200;

/// One entity targeted by a bulk option update.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct BulkTargetEntity {
    /// The type of entity. Tasks are targeted as 'document'.
    pub entity_type: ToolPropertyTargetEntityType,
    /// The id of the entity.
    pub entity_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "BulkSetEntityPropertyOptions",
    description = "Apply one multi-select option delta — most often a tag — to many entities in a single call. Use this instead of calling SetEntityProperty once per entity when the user asks to tag or label a set of items at once (e.g. \"tag the last 50 emails as Follow-up\"). Provide the property_definition_id (a tag set's propertyDefinitionId from ListTags) and the option ids to add and/or remove (a tag's option id from ListTags). The same add_option_ids/remove_option_ids delta is applied to every entity, composing atomically with concurrent edits per entity.

Only for multi-select or tag properties; for other value types, or a single entity, use SetEntityProperty. Up to 200 entities per call — split larger sets across multiple calls.

Best-effort: each entity is handled independently. Entities you don't have edit access to are reported with status 'skipped_no_permission' and left unchanged, entities that can't take the property are 'failed', and the rest are 'applied' — one call never fails wholesale because a few entities were not editable. Inspect the per-entity results and the summary to see what happened."
)]
#[serde(rename_all = "snake_case")]
pub struct BulkSetEntityPropertyOptions {
    /// The entities to update (up to 200). Entities the user can't edit are skipped.
    pub entities: Vec<BulkTargetEntity>,

    /// The multi-select property definition id changed on every entity — e.g. a
    /// tag set's propertyDefinitionId from ListTags.
    pub property_definition_id: Uuid,

    /// Options to add to every entity (e.g. a tag's option id from ListTags),
    /// deduped against each entity's current value.
    #[serde(default)]
    pub add_option_ids: Option<Vec<Uuid>>,

    /// Options to remove from every entity. Removing an absent option is a no-op.
    #[serde(default)]
    pub remove_option_ids: Option<Vec<Uuid>>,
}

/// One entity's result in the tool response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkSetEntityPropertyOptionsResult {
    /// The entity's type this result is for.
    pub entity_type: String,
    /// The entity's id this result is for.
    pub entity_id: String,
    /// One of: applied, skipped_no_permission, failed.
    pub status: String,
    /// A human-readable reason, present only when the status is failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Response from the BulkSetEntityPropertyOptions tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkSetEntityPropertyOptionsResponse {
    /// Per-entity results, aligned to the requested entities' order.
    pub results: Vec<BulkSetEntityPropertyOptionsResult>,
    /// Human-readable summary of how many entities were applied/skipped/failed.
    pub summary: String,
}

fn entity_type_label(entity_type: ToolPropertyTargetEntityType) -> &'static str {
    match entity_type {
        ToolPropertyTargetEntityType::Document => "document",
        ToolPropertyTargetEntityType::Project => "project",
        ToolPropertyTargetEntityType::Chat => "chat",
        ToolPropertyTargetEntityType::Thread => "thread",
        ToolPropertyTargetEntityType::Channel => "channel",
        ToolPropertyTargetEntityType::Call => "call",
        ToolPropertyTargetEntityType::User => "user",
        ToolPropertyTargetEntityType::Company => "company",
    }
}

impl ToolAnnotated for BulkSetEntityPropertyOptions {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Bulk-update properties");
}

#[async_trait]
impl<T, A> AsyncTool<PropertiesToolContext<T, A>> for BulkSetEntityPropertyOptions
where
    T: PropertiesService,
    A: EntityAccessService,
{
    type Output = BulkSetEntityPropertyOptionsResponse;

    #[tracing::instrument(
        skip_all,
        fields(
            user_id = ?request_context.user_id,
            entity_count = self.entities.len(),
            property_definition_id = %self.property_definition_id
        ),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<PropertiesToolContext<T, A>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Bulk set entity property options");

        if self.entities.len() > MAX_BULK_ENTITIES {
            return Err(ToolCallError {
                description: format!(
                    "Too many entities: {} provided, at most {MAX_BULK_ENTITIES} allowed per call. Split the request into smaller batches.",
                    self.entities.len()
                ),
                internal_error: anyhow::anyhow!("bulk option update entity cap exceeded"),
            });
        }

        let add_option_ids = self.add_option_ids.clone().unwrap_or_default();
        let remove_option_ids = self.remove_option_ids.clone().unwrap_or_default();
        if add_option_ids.is_empty() && remove_option_ids.is_empty() {
            return Err(ToolCallError {
                description: "Provide at least one of add_option_ids or remove_option_ids."
                    .to_string(),
                internal_error: anyhow::anyhow!("bulk option update with no delta"),
            });
        }

        // Mint one edit receipt per entity. Entities the caller can't edit are
        // recorded as skipped and never sent to the service.
        let mut results: Vec<Option<BulkSetEntityPropertyOptionsResult>> =
            (0..self.entities.len()).map(|_| None).collect();
        let mut receipts: Vec<EditReceipt> = Vec::new();
        let mut granted_indices: Vec<usize> = Vec::new();

        for (index, entity) in self.entities.iter().enumerate() {
            let entity_type = model_entity::EntityType::from(entity.entity_type);
            match service_context
                .entity_access_service
                .generate_bot_entity_access_receipt::<EditAccessLevel>(
                    service_context.actor,
                    BotAccessScope::user(request_context.user_id.clone()),
                    &entity.entity_id,
                    entity_type,
                )
                .await
            {
                Ok(receipt) => {
                    receipts.push(receipt);
                    granted_indices.push(index);
                }
                Err(error) => {
                    tracing::debug!(entity_id = %entity.entity_id, error = ?error, "no edit access, skipping entity");
                    results[index] = Some(BulkSetEntityPropertyOptionsResult {
                        entity_type: entity_type_label(entity.entity_type).to_string(),
                        entity_id: entity.entity_id.clone(),
                        status: "skipped_no_permission".to_string(),
                        error: None,
                    });
                }
            }
        }

        if !receipts.is_empty() {
            let outcomes = service_context
                .service
                .bulk_update_entities_property_options(
                    &receipts,
                    self.property_definition_id,
                    add_option_ids,
                    remove_option_ids,
                )
                .await
                .map_err(|e| ToolCallError {
                    description: format!("Failed to update property options: {e}"),
                    internal_error: e.into(),
                })?;

            for (index, outcome) in granted_indices.into_iter().zip(outcomes) {
                let entity = &self.entities[index];
                let (status, error) = match outcome {
                    EntityOptionUpdateOutcome::Applied { .. } => ("applied".to_string(), None),
                    EntityOptionUpdateOutcome::Failed { message } => {
                        ("failed".to_string(), Some(message))
                    }
                };
                results[index] = Some(BulkSetEntityPropertyOptionsResult {
                    entity_type: entity_type_label(entity.entity_type).to_string(),
                    entity_id: entity.entity_id.clone(),
                    status,
                    error,
                });
            }
        }

        let results: Vec<BulkSetEntityPropertyOptionsResult> = results
            .into_iter()
            .map(|result| result.expect("every entity yields a result"))
            .collect();

        let applied = results.iter().filter(|r| r.status == "applied").count();
        let skipped = results
            .iter()
            .filter(|r| r.status == "skipped_no_permission")
            .count();
        let failed = results.iter().filter(|r| r.status == "failed").count();
        let summary = format!(
            "{applied} applied, {skipped} skipped (no permission), {failed} failed out of {} entities.",
            results.len()
        );

        Ok(BulkSetEntityPropertyOptionsResponse { results, summary })
    }
}
