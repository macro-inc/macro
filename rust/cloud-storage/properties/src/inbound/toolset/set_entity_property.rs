//! SetEntityProperty tool for updating property values on entities.

use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::shared::EntityReference;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::PropertiesToolContext;
use super::get_entity_properties::ToolEntityType;

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
    description = "Set or update a property value on an entity (document, task, project, etc.). Provide the property_definition_id and exactly one value field matching the property's data type.

Tasks always have these system properties (use these property_definition_id values directly):
- Assignees (00000001-0000-0000-0000-000000000001): entity type, multi-select. Use entity_refs with entity_type='user' and entity_id='macro|email@domain.com'.
- Status (00000001-0000-0000-0000-000000000002): select_string, single. Options: Not Started (00000001-0000-0000-0002-000000000001), In Progress (...0002), In Review (...0003), Completed (...0004), Canceled (...0005).
- Priority (00000001-0000-0000-0000-000000000003): select_string, single. Options: Low (...0001), Medium (...0002), High (...0003), Urgent (...0004). Option IDs: 00000001-0000-0000-0003-0000000000XX.
- Due Date (00000001-0000-0000-0000-000000000004): date, single. Use date_value with ISO 8601.
- Parent Task (00000001-0000-0000-0000-000000000005): entity, single. Use entity_ref with entity_type='task'.
- Subtasks (00000001-0000-0000-0000-000000000006): entity, multi. Use entity_refs with entity_type='task'.
- Story Points (00000001-0000-0000-0000-000000000009): number, single. Use number_value.

For non-system or custom properties, call GetEntityProperties first to discover property_definition_id values and options."
)]
#[serde(rename_all = "snake_case")]
pub struct SetEntityProperty {
    #[schemars(description = "The ID of the entity to update.")]
    pub entity_id: String,

    #[schemars(description = "The type of entity.")]
    pub entity_type: ToolEntityType,

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
        description = "For multi-select properties. The option UUIDs from available options."
    )]
    #[serde(default)]
    pub option_ids: Option<Vec<Uuid>>,

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

#[async_trait]
impl<T> AsyncTool<PropertiesToolContext<T>> for SetEntityProperty
where
    T: PropertiesService,
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
        service_context: ServiceContext<PropertiesToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Set entity property");

        let entity_type = EntityType::from(self.entity_type);
        let set_value = self.to_set_property_value();
        let user_id: &str = request_context.user_id.0.as_ref();

        service_context
            .service
            .set_entity_property(
                user_id,
                &self.entity_id,
                entity_type,
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
