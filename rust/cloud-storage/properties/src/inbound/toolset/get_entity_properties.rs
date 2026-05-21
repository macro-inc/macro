//! GetEntityProperties tool for reading properties attached to an entity.

use crate::domain::model::{EntityPropertyInfo, PropertyOptionInfo};
use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityType};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::PropertiesToolContext;

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolEntityType {
    Document,
    Task,
    Project,
    Chat,
    Thread,
    Channel,
    User,
}

impl From<ToolEntityType> for EntityType {
    fn from(t: ToolEntityType) -> Self {
        match t {
            ToolEntityType::Document => EntityType::Document,
            ToolEntityType::Task => EntityType::Task,
            ToolEntityType::Project => EntityType::Project,
            ToolEntityType::Chat => EntityType::Chat,
            ToolEntityType::Thread => EntityType::Thread,
            ToolEntityType::Channel => EntityType::Channel,
            ToolEntityType::User => EntityType::User,
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "GetEntityProperties",
    description = "Get all properties attached to an entity (document, task, project, etc.). Returns property definitions with their current values and available options for select-type properties. Use this to discover custom properties on an entity. For tasks, system properties (Assignees, Status, Priority, Due Date, etc.) are always present — you can update them directly with SetEntityProperty using well-known IDs without calling this first."
)]
pub struct GetEntityProperties {
    #[schemars(description = "The ID of the entity to get properties for.")]
    pub entity_id: String,

    #[schemars(description = "The type of entity.")]
    pub entity_type: ToolEntityType,
}

/// A property option in the tool response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPropertyOption {
    /// The option ID to use when setting select values.
    pub id: Uuid,
    /// Display order.
    pub display_order: i32,
    /// The display value of this option.
    pub display_value: String,
}

/// A single property in the tool response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPropertyItem {
    /// The property definition ID. Use this when calling SetEntityProperty.
    pub property_definition_id: Uuid,
    /// Human-readable name of the property.
    pub display_name: String,
    /// The data type (boolean, date, number, string, select_number, select_string, entity, link).
    pub data_type: String,
    /// Whether this property supports multiple values.
    pub is_multi_select: bool,
    /// Whether this is a system-defined property.
    pub is_system: bool,
    /// The current value, if set.
    pub current_value: Option<serde_json::Value>,
    /// Available options for select-type properties.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<ToolPropertyOption>,
}

/// Response from the GetEntityProperties tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetEntityPropertiesResponse {
    /// The properties attached to the entity.
    pub properties: Vec<ToolPropertyItem>,
    /// Human-readable summary.
    pub summary: String,
}

#[async_trait]
impl<T> AsyncTool<PropertiesToolContext<T>> for GetEntityProperties
where
    T: PropertiesService,
{
    type Output = GetEntityPropertiesResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, entity_id=%self.entity_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<PropertiesToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Get entity properties");
        let _ = &request_context;

        let entity_type = EntityType::from(self.entity_type);

        let props = service_context
            .service
            .get_entity_properties(&self.entity_id, entity_type)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to get entity properties: {e}"),
                internal_error: e.into(),
            })?;

        let properties: Vec<ToolPropertyItem> = props.into_iter().map(to_tool_property).collect();

        let summary = if properties.is_empty() {
            "No properties attached to this entity.".to_string()
        } else {
            let set_count = properties
                .iter()
                .filter(|p| p.current_value.is_some())
                .count();
            format!(
                "Found {} propert{} ({} with values set).",
                properties.len(),
                if properties.len() == 1 { "y" } else { "ies" },
                set_count,
            )
        };

        Ok(GetEntityPropertiesResponse {
            properties,
            summary,
        })
    }
}

fn to_tool_property(info: EntityPropertyInfo) -> ToolPropertyItem {
    let data_type = match info.data_type {
        DataType::Boolean => "boolean",
        DataType::Date => "date",
        DataType::Number => "number",
        DataType::String => "string",
        DataType::SelectNumber => "select_number",
        DataType::SelectString => "select_string",
        DataType::Entity => "entity",
        DataType::Link => "link",
    }
    .to_string();

    let current_value = info.value.map(|v| property_value_to_json(&v));

    let options = info.options.into_iter().map(to_tool_option).collect();

    ToolPropertyItem {
        property_definition_id: info.property_definition_id,
        display_name: info.display_name,
        data_type,
        is_multi_select: info.is_multi_select,
        is_system: info.is_system,
        current_value,
        options,
    }
}

fn property_value_to_json(value: &PropertyValue) -> serde_json::Value {
    // Serialize the PropertyValue directly - it has good serde representation
    serde_json::to_value(value).unwrap_or(serde_json::Value::Null)
}

fn to_tool_option(opt: PropertyOptionInfo) -> ToolPropertyOption {
    let display_value = match &opt.value {
        PropertyOptionValue::String(s) => s.clone(),
        PropertyOptionValue::Number(n) => n.to_string(),
    };

    ToolPropertyOption {
        id: opt.id,
        display_order: opt.display_order,
        display_value,
    }
}
