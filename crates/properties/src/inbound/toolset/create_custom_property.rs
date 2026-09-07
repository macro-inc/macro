//! CreateCustomProperty tool for adding a team or personal custom field.

use crate::domain::error::PropertiesErr;
use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_properties::api::{
    CreatePropertyDefinitionRequest, CreatePropertyScope, PropertyDataType, SelectNumberOption,
    SelectStringOption,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::get_entity_properties::{ToolEntityType, ToolPropertyOption};
use super::{PropertiesToolContext, caller_team_receipt_opt, data_type_name};

fn default_scope() -> CreatePropertyScope {
    CreatePropertyScope::Team
}

// Deliberately flat (unlike the nested API `PropertyDataType`) so the agent
// picks one name and passes `options` / `multi` / `referenced_entity_type`
// alongside it; `to_create_request` folds them back together.
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
    pub scope: CreatePropertyScope,

    #[schemars(
        description = "For select and select_number, the choices to create with the property, in display order. For select_number each value must be a numeric string (e.g. [\"1\", \"2\", \"3\"]). Omit for other types."
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
    pub scope: CreatePropertyScope,
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
    /// Map the flat agent-facing params onto the API request, the way an axum
    /// handler's `Json<Request>` extractor does. Only input shape is checked:
    /// which params go with which type, and that a select has its (conditionally
    /// required) `options` — the same completeness rule the create-property UI
    /// applies, and not a domain invariant since import creates selects first and
    /// fills options later. Name length, option values, uniqueness, and team
    /// membership are all decided by the domain.
    pub(crate) fn to_create_request(
        &self,
    ) -> Result<CreatePropertyDefinitionRequest, ToolCallError> {
        use ToolPropertyDataType as Kind;

        let kind = self.data_type;
        let is_select = matches!(kind, Kind::Select | Kind::SelectNumber);
        let is_scalar = matches!(
            kind,
            Kind::String | Kind::Number | Kind::Boolean | Kind::Date
        );
        let options: Vec<&str> = self
            .options
            .iter()
            .map(|o| o.trim())
            .filter(|o| !o.is_empty())
            .collect();

        if !options.is_empty() && !is_select {
            return Err(tool_error(
                "`options` is only valid for select and select_number properties.",
            ));
        }
        if is_select && options.is_empty() {
            return Err(tool_error(
                "select properties need at least one choice in `options`, e.g. [\"Engineering\", \"Sales\"].",
            ));
        }
        if self.referenced_entity_type.is_some() && kind != Kind::Entity {
            return Err(tool_error(
                "`referenced_entity_type` is only valid for entity properties.",
            ));
        }
        if self.multi && is_scalar {
            return Err(tool_error(
                "`multi` is only valid for select, select_number, entity, and link properties.",
            ));
        }

        let multi = self.multi;
        let data_type = match kind {
            Kind::String => PropertyDataType::String,
            Kind::Number => PropertyDataType::Number,
            Kind::Boolean => PropertyDataType::Boolean,
            Kind::Date => PropertyDataType::Date,
            Kind::Select => PropertyDataType::SelectString {
                options: options
                    .iter()
                    .enumerate()
                    .map(|(i, value)| SelectStringOption {
                        display_order: i as i32,
                        value: value.to_string(),
                    })
                    .collect(),
                multi,
            },
            Kind::SelectNumber => PropertyDataType::SelectNumber {
                options: options
                    .iter()
                    .enumerate()
                    .map(|(i, value)| {
                        let parsed = value.parse::<f64>().map_err(|_| {
                            tool_error(format!(
                                "select_number options must be numeric strings, got \"{value}\"."
                            ))
                        })?;
                        Ok(SelectNumberOption {
                            display_order: i as i32,
                            value: parsed,
                        })
                    })
                    .collect::<Result<_, ToolCallError>>()?,
                multi,
            },
            Kind::Entity => PropertyDataType::Entity {
                specific_type: self.referenced_entity_type.map(Into::into),
                multi,
            },
            Kind::Link => PropertyDataType::Link { multi },
        };

        Ok(CreatePropertyDefinitionRequest {
            scope: self.scope,
            display_name: self.display_name.trim().to_string(),
            data_type,
        })
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
        // Same as the HTTP route's PropertyTeamExtractor: resolve the caller's
        // team receipt if they have one and let the domain decide what it needs.
        let team = caller_team_receipt_opt(&service_context, &request_context).await?;

        let created = service_context
            .service
            .create_property_definition(&request_context.user_id, team.as_ref(), &request)
            .await
            .map_err(map_create_error)?;

        let definition = created.definition;
        let options: Vec<ToolPropertyOption> = created
            .property_options
            .into_iter()
            .map(Into::into)
            .collect();

        let scope_word = match self.scope {
            CreatePropertyScope::Team => "team",
            CreatePropertyScope::User => "personal",
        };
        let mut summary = format!(
            "Created the {scope_word} {} property \"{}\"",
            data_type_name(definition.data_type),
            definition.display_name
        );
        if !options.is_empty() {
            let labels: Vec<String> = options
                .iter()
                .map(|o| format!("\"{}\"", o.display_value))
                .collect();
            summary.push_str(&format!(" with options {}", labels.join(", ")));
        }
        summary.push('.');

        Ok(CreateCustomPropertyResponse {
            property_definition_id: definition.id,
            display_name: definition.display_name,
            data_type: data_type_name(definition.data_type).to_string(),
            is_multi_select: definition.is_multi_select,
            scope: self.scope,
            options,
            summary,
        })
    }
}

fn map_create_error(err: PropertiesErr) -> ToolCallError {
    let description = match &err {
        PropertiesErr::TeamMembershipRequired => {
            "You are not on a team, so you can't create a team property. Set scope to \"user\" to create a personal property.".to_string()
        }
        PropertiesErr::DuplicatePropertyName => {
            "A property with that name already exists. Find its property_definition_id with GetEntityProperties on an item, then use SetEntityProperty — don't create another.".to_string()
        }
        PropertiesErr::Validation(msg) => msg.clone(),
        other => format!("Failed to create property: {other}"),
    };
    ToolCallError {
        description,
        internal_error: err.into(),
    }
}

fn tool_error(description: impl Into<String>) -> ToolCallError {
    let description = description.into();
    ToolCallError {
        internal_error: anyhow::anyhow!("{description}"),
        description,
    }
}
