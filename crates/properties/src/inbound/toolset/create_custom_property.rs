//! CreateCustomProperty tool for adding a team or personal custom field.

use std::collections::HashSet;

use crate::domain::error::PropertiesErr;
use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_properties::DataType;
use models_properties::api::{
    CreatePropertyDefinitionRequest, CreatePropertyScope, PropertyDataType, SelectNumberOption,
    SelectStringOption,
};
use models_properties::service::property_option::PropertyOptionValue;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::PropertiesToolContext;
use super::caller_team_receipt_opt;
use super::get_entity_properties::{ToolEntityType, ToolPropertyOption};

fn default_scope() -> ToolPropertyScope {
    ToolPropertyScope::Team
}

/// Who owns the new custom property.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolPropertyScope {
    Team,
    User,
}

impl From<ToolPropertyScope> for CreatePropertyScope {
    fn from(scope: ToolPropertyScope) -> Self {
        match scope {
            ToolPropertyScope::Team => CreatePropertyScope::Team,
            ToolPropertyScope::User => CreatePropertyScope::User,
        }
    }
}

/// The data type of the custom property to create.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolPropertyDataType {
    String,
    Number,
    Boolean,
    Date,
    Select,
    SelectNumber,
    Entity,
    Link,
}

/// Create a new custom property definition for the user's team or personal set.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "CreateCustomProperty",
    description = "Create a new custom property — a structured field the user can attach to documents, tasks, emails, CRM companies, and other items. This is not a tag: for a colored label, use CreateTag instead. Defaults to the user's team so everyone on the team can use the field; set scope to \"user\" for a personal-only field. Returns the new property_definition_id, which you pass to SetEntityProperty to set a value on an item. If a property with this name already exists, do not create another — call GetEntityProperties on a relevant item to find its id. For select / select_number, pass the choices in `options` in this same call (e.g. Department with options [\"Engineering\", \"Sales\"]). Set `multi` true for multi-select. For entity properties, optionally set `referenced_entity_type` to restrict what can be linked (user, document, task, and so on)."
)]
#[serde(rename_all = "snake_case")]
pub struct CreateCustomProperty {
    #[schemars(
        description = "The property's display name, e.g. \"Department\" or \"Renewal date\"."
    )]
    pub display_name: String,

    #[schemars(
        description = "The field type: string (free text), number, boolean (checkbox), date, select (named choices), select_number (numeric choices), entity (link to another item), or link (URL)."
    )]
    pub data_type: ToolPropertyDataType,

    #[schemars(
        description = "Who owns the property: \"team\" (shared with the user's team, the default) or \"user\" (personal only). \"team\" requires the user to belong to a team."
    )]
    #[serde(default = "default_scope")]
    pub scope: ToolPropertyScope,

    #[schemars(
        description = "For select and select_number, the choices to create with the property, in display order. For select_number each value must be a number (e.g. [\"1\", \"2\", \"3\"]). Omit for other types."
    )]
    #[serde(default)]
    pub options: Vec<String>,

    #[schemars(
        description = "True if the property should accept multiple values. Only valid for select, select_number, entity, and link. Defaults to false."
    )]
    #[serde(default)]
    pub multi: bool,

    #[schemars(
        description = "For entity properties, restrict links to this entity type (user, document, task, project, channel, chat, thread, call, company). Omit to allow any entity."
    )]
    #[serde(default)]
    pub referenced_entity_type: Option<ToolEntityType>,
}

/// Response from the [`CreateCustomProperty`] tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomPropertyResponse {
    /// The new property definition id. Use it as propertyDefinitionId with SetEntityProperty.
    pub property_definition_id: Uuid,
    /// The property's display name.
    pub display_name: String,
    /// The data type (string, number, boolean, date, select_string, select_number, entity, link).
    pub data_type: String,
    /// Whether the property accepts multiple values.
    pub is_multi_select: bool,
    /// Whether the property is team-shared or personal.
    pub scope: ToolPropertyScope,
    /// Select options created with the property, empty for non-select types.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<ToolPropertyOption>,
    /// Human-readable summary.
    pub summary: String,
}

impl ToolAnnotated for CreateCustomProperty {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create custom property");
}

impl CreateCustomProperty {
    fn trimmed_name(&self) -> &str {
        self.display_name.trim()
    }

    pub(crate) fn to_create_request(
        &self,
    ) -> Result<CreatePropertyDefinitionRequest, ToolCallError> {
        if self.trimmed_name().is_empty() {
            return Err(tool_error(
                "display_name is required, e.g. \"Department\" or \"Renewal date\".",
            ));
        }

        let data_type = self.to_property_data_type()?;
        Ok(CreatePropertyDefinitionRequest {
            scope: self.scope.into(),
            display_name: self.trimmed_name().to_string(),
            data_type,
        })
    }

    fn to_property_data_type(&self) -> Result<PropertyDataType, ToolCallError> {
        match self.data_type {
            ToolPropertyDataType::String => {
                self.reject_select_fields("string")?;
                self.reject_entity_fields("string")?;
                Ok(PropertyDataType::String)
            }
            ToolPropertyDataType::Number => {
                self.reject_select_fields("number")?;
                self.reject_entity_fields("number")?;
                Ok(PropertyDataType::Number)
            }
            ToolPropertyDataType::Boolean => {
                self.reject_select_fields("boolean")?;
                self.reject_entity_fields("boolean")?;
                Ok(PropertyDataType::Boolean)
            }
            ToolPropertyDataType::Date => {
                self.reject_select_fields("date")?;
                self.reject_entity_fields("date")?;
                Ok(PropertyDataType::Date)
            }
            ToolPropertyDataType::Select => {
                self.reject_entity_fields("select")?;
                Ok(PropertyDataType::SelectString {
                    options: self.select_string_options()?,
                    multi: self.multi,
                })
            }
            ToolPropertyDataType::SelectNumber => {
                self.reject_entity_fields("select_number")?;
                Ok(PropertyDataType::SelectNumber {
                    options: self.select_number_options()?,
                    multi: self.multi,
                })
            }
            ToolPropertyDataType::Entity => {
                self.reject_select_fields("entity")?;
                Ok(PropertyDataType::Entity {
                    specific_type: self.referenced_entity_type.map(Into::into),
                    multi: self.multi,
                })
            }
            ToolPropertyDataType::Link => {
                self.reject_select_fields("link")?;
                self.reject_entity_fields("link")?;
                Ok(PropertyDataType::Link { multi: self.multi })
            }
        }
    }

    fn reject_select_fields(&self, data_type: &str) -> Result<(), ToolCallError> {
        if !self.options.iter().any(|o| !o.trim().is_empty()) {
            return Ok(());
        }
        Err(tool_error(format!(
            "`options` is only valid for select and select_number properties, not {data_type}."
        )))
    }

    fn reject_entity_fields(&self, data_type: &str) -> Result<(), ToolCallError> {
        if self.referenced_entity_type.is_none() {
            return Ok(());
        }
        Err(tool_error(format!(
            "`referenced_entity_type` is only valid for entity properties, not {data_type}."
        )))
    }

    fn select_string_options(&self) -> Result<Vec<SelectStringOption>, ToolCallError> {
        let values = self.trimmed_options()?;
        Ok(values
            .into_iter()
            .enumerate()
            .map(|(i, value)| SelectStringOption {
                display_order: i as i32,
                value,
            })
            .collect())
    }

    fn select_number_options(&self) -> Result<Vec<SelectNumberOption>, ToolCallError> {
        let values = self.trimmed_options()?;
        values
            .into_iter()
            .enumerate()
            .map(|(i, value)| {
                let parsed = value.parse::<f64>().map_err(|_| {
                    tool_error(format!(
                        "select_number options must be numbers, got \"{value}\"."
                    ))
                })?;
                Ok(SelectNumberOption {
                    display_order: i as i32,
                    value: parsed,
                })
            })
            .collect()
    }

    fn trimmed_options(&self) -> Result<Vec<String>, ToolCallError> {
        let mut seen = HashSet::new();
        let mut values = Vec::new();
        for raw in &self.options {
            let value = raw.trim();
            if value.is_empty() {
                continue;
            }
            if !seen.insert(value.to_lowercase()) {
                return Err(tool_error(format!(
                    "Duplicate option \"{value}\". Each select choice must be unique."
                )));
            }
            values.push(value.to_string());
        }
        if values.is_empty() {
            return Err(tool_error(
                "select properties need at least one choice in `options`, e.g. [\"Engineering\", \"Sales\"].",
            ));
        }
        Ok(values)
    }
}

#[async_trait]
impl<T, A> AsyncTool<PropertiesToolContext<T, A>> for CreateCustomProperty
where
    T: PropertiesService,
    A: EntityAccessService,
{
    type Output = CreateCustomPropertyResponse;

    #[tracing::instrument(
        skip_all,
        fields(
            user_id=?request_context.user_id,
            display_name=%self.display_name,
            data_type=?self.data_type,
            scope=?self.scope
        ),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<PropertiesToolContext<T, A>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Create custom property");

        let request = self.to_create_request()?;
        let team = match self.scope {
            ToolPropertyScope::User => None,
            ToolPropertyScope::Team => Some(
                caller_team_receipt_opt(&service_context, &request_context)
                    .await?
                    .ok_or_else(|| {
                        tool_error(
                            "You are not on a team, so you can't create a team property. Set scope to \"user\" to create a personal property.",
                        )
                    })?,
            ),
        };
        let team_ref = team.as_ref();
        let user_id = &request_context.user_id;

        let property = service_context
            .service
            .create_property_definition(user_id, team_ref, &request)
            .await
            .map_err(|e| map_create_error(e, request.display_name.as_str()))?;

        let options = if matches!(
            property.data_type,
            DataType::SelectString | DataType::SelectNumber
        ) {
            service_context
                .service
                .get_property_options(property.id, user_id, team_ref)
                .await
                .map(|opts| {
                    opts.into_iter()
                        .map(|opt| ToolPropertyOption {
                            id: opt.id,
                            display_order: opt.display_order,
                            display_value: option_display_value(&opt.value),
                        })
                        .collect()
                })
                .unwrap_or_else(|e| {
                    tracing::error!(error=?e, "failed to load options for newly created property");
                    Vec::new()
                })
        } else {
            Vec::new()
        };

        let data_type = data_type_name(property.data_type).to_string();
        let scope_word = match self.scope {
            ToolPropertyScope::Team => "team",
            ToolPropertyScope::User => "personal",
        };
        let options_clause = if options.is_empty() {
            String::new()
        } else {
            format!(
                " with options {}.",
                options
                    .iter()
                    .map(|o| format!("\"{}\"", o.display_value))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        let period = if options_clause.is_empty() { "." } else { "" };
        let summary = format!(
            "Created the {scope_word} {data_type} property \"{}\"{period}{options_clause}",
            property.display_name
        );

        Ok(CreateCustomPropertyResponse {
            property_definition_id: property.id,
            display_name: property.display_name,
            data_type,
            is_multi_select: property.is_multi_select,
            scope: self.scope,
            options,
            summary,
        })
    }
}

fn data_type_name(data_type: DataType) -> &'static str {
    match data_type {
        DataType::Boolean => "boolean",
        DataType::Date => "date",
        DataType::Number => "number",
        DataType::String => "string",
        DataType::SelectNumber => "select_number",
        DataType::SelectString => "select_string",
        DataType::Tag => "tag",
        DataType::Entity => "entity",
        DataType::Link => "link",
    }
}

fn option_display_value(value: &PropertyOptionValue) -> String {
    match value {
        PropertyOptionValue::String(s) => s.clone(),
        PropertyOptionValue::Number(n) => n.to_string(),
    }
}

fn map_create_error(err: PropertiesErr, display_name: &str) -> ToolCallError {
    match &err {
        PropertiesErr::TeamMembershipRequired => tool_error_with(
            "You are not on a team, so you can't create a team property. Set scope to \"user\" to create a personal property.",
            err,
        ),
        PropertiesErr::Validation(msg) => tool_error_with(msg.clone(), err),
        PropertiesErr::Repo(repo_err) if is_duplicate_display_name(repo_err) => tool_error_with(
            format!(
                "A property named \"{display_name}\" already exists. Find its property_definition_id with GetEntityProperties on an item, then use SetEntityProperty — don't create another."
            ),
            err,
        ),
        _ => tool_error_with(format!("Failed to create property: {err}"), err),
    }
}

fn is_duplicate_display_name(err: &anyhow::Error) -> bool {
    let text = format!("{err:#}").to_lowercase();
    text.contains("unique_property_definitions")
        || (text.contains("duplicate key") && text.contains("display_name"))
}

fn tool_error(description: impl Into<String>) -> ToolCallError {
    let description = description.into();
    ToolCallError {
        internal_error: anyhow::anyhow!("{description}"),
        description,
    }
}

fn tool_error_with(description: impl Into<String>, err: PropertiesErr) -> ToolCallError {
    ToolCallError {
        description: description.into(),
        internal_error: err.into(),
    }
}
