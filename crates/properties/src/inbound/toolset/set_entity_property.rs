//! SetEntityProperty tool for updating property values on entities.

use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{BotAccessScope, EditAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::shared::EntityReference;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::PropertiesToolContext;
use super::get_entity_properties::{ToolEntityType, ToolPropertyTargetEntityType};

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntityRef {
    pub entity_type: ToolEntityType,
    pub entity_id: String,
}

/// How to determine which value field is active, based on the property data type from
/// GetEntityProperties. The AI must set the matching field:
///  - boolean → boolean_value
///  - date → date_value
///  - number → number_value
///  - string → string_value
///  - select_string/select_number (single) → option_id
///  - select_string/select_number (multi) → option_ids
///  - entity (single) → entity_ref
///  - entity (multi) → entity_refs
///  - link (single) → link_url
///  - link (multi) → link_urls
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "SetEntityProperty",
    description = "Set or update a property value on an entity (document, project, etc.). Tasks are targeted as entity_type='document'. Provide the property_definition_id and exactly one value field matching the property's data type.

For multi-select properties — including tags — prefer add_option_ids / remove_option_ids over option_ids: they add or remove just those options atomically, composing with concurrent edits. option_ids replaces the entire value, so a stale read can silently drop options someone else just added; only use it when the user asks to set the value to exactly a given list. To apply a tag, pass the tag set's property_definition_id and the tag's option id (both from ListTags) in add_option_ids; to remove a tag, use remove_option_ids.

Tasks always have these system properties (use these property_definition_id values directly):
- Assignees (00000001-0000-0000-0000-000000000001): entity type, multi-select. Use entity_refs with entity_type='user' and entity_id='macro|email@domain.com'.
- Status (00000001-0000-0000-0000-000000000002): select_string, single. Options: Not Started (00000001-0000-0000-0002-000000000001), In Progress (...0002), In Review (...0003), Completed (...0004), Canceled (...0005).
- Priority (00000001-0000-0000-0000-000000000003): select_string, single. Options: Low (...0001), Medium (...0002), High (...0003), Urgent (...0004). Option IDs: 00000001-0000-0000-0003-0000000000XX.
- Due Date (00000001-0000-0000-0000-000000000004): date, single. Use date_value with ISO 8601.
- Parent Task (00000001-0000-0000-0000-000000000005): entity, single. Use entity_ref with entity_type='task'.
- Subtasks (00000001-0000-0000-0000-000000000006): entity, multi. Use entity_refs with entity_type='task'.
- Story Points (00000001-0000-0000-0000-000000000009): number, single. Use number_value.

CRM companies (entity_type='company', entity_id=the company UUID) always have these system properties:
- Stage (00000001-0000-0000-0000-000000000010): select_string, single. Use option_id. Default options: Lead (00000001-0000-0000-0010-000000000001), Qualified (...0002), Demo (...0003), Trial (...0004), Negotiation (...0005), Customer (...0006), Churned (...0007). Teams can customize their stages, so prefer calling GetCompany or GetEntityProperties first to get the valid stage option ids.
- Owner (00000001-0000-0000-0000-000000000011): entity, single. Use entity_ref with entity_type='user' and entity_id='macro|email@domain.com'.
- Revenue (00000001-0000-0000-0000-000000000012): number, single. Use number_value (dollars).
Any member of the owning team can edit visible company properties; hidden records remain admin/owner-only.

For non-system or custom properties, call GetEntityProperties first to discover property_definition_id values and options."
)]
#[serde(rename_all = "snake_case")]
pub struct SetEntityProperty {
    #[schemars(description = "The ID of the entity to update.")]
    pub entity_id: String,

    #[schemars(description = "The type of entity.")]
    pub entity_type: ToolPropertyTargetEntityType,

    #[schemars(
        description = "The property definition ID. Get this from GetEntityProperties results."
    )]
    pub property_definition_id: Uuid,

    #[schemars(description = "For boolean properties.")]
    #[serde(default)]
    pub boolean_value: Option<bool>,

    #[schemars(description = "For date properties (ISO 8601 date-time).")]
    #[serde(default)]
    pub date_value: Option<DateTime<Utc>>,

    #[schemars(description = "For number properties.")]
    #[serde(default)]
    pub number_value: Option<f64>,

    #[schemars(description = "For string properties.")]
    #[serde(default)]
    pub string_value: Option<String>,

    #[schemars(
        description = "For single-select properties. The option UUID from available options."
    )]
    #[serde(default)]
    pub option_id: Option<Uuid>,

    #[schemars(
        description = "For multi-select properties. Replaces the entire value with these option UUIDs — prefer add_option_ids / remove_option_ids for adding or removing specific options."
    )]
    #[serde(default)]
    pub option_ids: Option<Vec<Uuid>>,

    #[schemars(
        description = "For multi-select properties (including tags): add these options to the current value atomically without touching other options. Cannot be combined with other value fields."
    )]
    #[serde(default)]
    pub add_option_ids: Option<Vec<Uuid>>,

    #[schemars(
        description = "For multi-select properties (including tags): remove these options from the current value atomically without touching other options. Removing an absent option is a no-op. Cannot be combined with other value fields."
    )]
    #[serde(default)]
    pub remove_option_ids: Option<Vec<Uuid>>,

    #[schemars(description = "For single entity reference properties.")]
    #[serde(default)]
    pub entity_ref: Option<ToolEntityRef>,

    #[schemars(description = "For multi entity reference properties.")]
    #[serde(default)]
    pub entity_refs: Option<Vec<ToolEntityRef>>,

    #[schemars(description = "For single link properties.")]
    #[serde(default)]
    pub link_url: Option<String>,

    #[schemars(description = "For multi link properties.")]
    #[serde(default)]
    pub link_urls: Option<Vec<String>>,
}

impl SetEntityProperty {
    fn to_set_property_value(&self) -> Option<SetPropertyValue> {
        if let Some(v) = self.boolean_value {
            return Some(SetPropertyValue::Boolean { value: v });
        }
        if let Some(v) = self.date_value {
            return Some(SetPropertyValue::Date { value: v });
        }
        if let Some(v) = self.number_value {
            return Some(SetPropertyValue::Number { value: v });
        }
        if let Some(v) = &self.string_value {
            return Some(SetPropertyValue::String { value: v.clone() });
        }
        if let Some(v) = self.option_id {
            return Some(SetPropertyValue::SelectOption { option_id: v });
        }
        if let Some(v) = &self.option_ids {
            return Some(SetPropertyValue::MultiSelectOption {
                option_ids: v.clone(),
            });
        }
        if let Some(v) = &self.entity_ref {
            return Some(SetPropertyValue::EntityReference {
                reference: EntityReference {
                    entity_type: EntityType::from(v.entity_type),
                    entity_id: v.entity_id.clone(),
                    specific_message_id: None,
                },
            });
        }
        if let Some(v) = &self.entity_refs {
            return Some(SetPropertyValue::MultiEntityReference {
                references: v
                    .iter()
                    .map(|r| EntityReference {
                        entity_type: EntityType::from(r.entity_type),
                        entity_id: r.entity_id.clone(),
                        specific_message_id: None,
                    })
                    .collect(),
            });
        }
        if let Some(v) = &self.link_url {
            return Some(SetPropertyValue::Link { url: v.clone() });
        }
        if let Some(v) = &self.link_urls {
            return Some(SetPropertyValue::MultiLink { urls: v.clone() });
        }
        None
    }
}

/// Response from the SetEntityProperty tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetEntityPropertyResponse {
    pub success: bool,
    pub message: String,
}

impl ToolAnnotated for SetEntityProperty {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Set entity property");
}

#[async_trait]
impl<T, A> AsyncTool<PropertiesToolContext<T, A>> for SetEntityProperty
where
    T: PropertiesService,
    A: EntityAccessService,
{
    type Output = SetEntityPropertyResponse;

    #[tracing::instrument(
        skip_all,
        fields(
            user_id=?request_context.user_id,
            entity_id=%self.entity_id,
            property_definition_id=%self.property_definition_id
        ),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<PropertiesToolContext<T, A>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Set entity property");

        let entity_type = model_entity::EntityType::from(self.entity_type);
        let set_value = self.to_set_property_value();

        // Prove the requesting user can edit the entity before writing anything.
        let entity_access_receipt = service_context
            .entity_access_service
            .generate_bot_entity_access_receipt::<EditAccessLevel>(
                service_context.actor,
                BotAccessScope::user(request_context.user_id.clone()),
                &self.entity_id,
                entity_type,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "You do not have edit access to this entity".to_string(),
                internal_error: e.into(),
            })?;
        // Delta mode: add/remove specific options atomically so concurrent
        // edits to the same multi-select value are never overwritten.
        let add_option_ids = self.add_option_ids.as_deref().unwrap_or_default();
        let remove_option_ids = self.remove_option_ids.as_deref().unwrap_or_default();
        if !add_option_ids.is_empty() || !remove_option_ids.is_empty() {
            if set_value.is_some() {
                return Err(ToolCallError {
                    description: "add_option_ids/remove_option_ids cannot be combined with other value fields".to_string(),
                    internal_error: anyhow::anyhow!(
                        "delta option fields combined with a value field"
                    ),
                });
            }

            for option_id in add_option_ids {
                service_context
                    .service
                    .add_entity_property_option(
                        &entity_access_receipt,
                        self.property_definition_id,
                        *option_id,
                    )
                    .await
                    .map_err(|e| ToolCallError {
                        description: format!("Failed to add option {option_id}: {e}"),
                        internal_error: e.into(),
                    })?;
            }
            for option_id in remove_option_ids {
                service_context
                    .service
                    .remove_entity_property_option(
                        &entity_access_receipt,
                        self.property_definition_id,
                        *option_id,
                    )
                    .await
                    .map_err(|e| ToolCallError {
                        description: format!("Failed to remove option {option_id}: {e}"),
                        internal_error: e.into(),
                    })?;
            }

            return Ok(SetEntityPropertyResponse {
                success: true,
                message: "Property options updated successfully.".to_string(),
            });
        }

        service_context
            .service
            .set_entity_property(
                &entity_access_receipt,
                self.property_definition_id,
                set_value,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to set property: {e}"),
                internal_error: e.into(),
            })?;

        Ok(SetEntityPropertyResponse {
            success: true,
            message: "Property updated successfully.".to_string(),
        })
    }
}
