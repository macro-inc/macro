//! CreateTag tool for adding a new tag to the caller's personal or team set.

use crate::domain::model::TagScope as DomainTagScope;
use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_properties::api::{AddPropertyOptionRequest, AddStringOptionRequest};
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::tag_sets::TagScope;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::tag_color::TagColor;
use super::{PropertiesToolContext, caller_team_receipt_opt};

fn default_tag_scope() -> TagScope {
    TagScope::Personal
}

/// Create a new tag in the caller's personal or team set.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "CreateTag",
    description = "Create a new tag — a colored label the user can apply to documents, emails, tasks, AI chats, and projects — in the user's personal set or their team's shared set. The set is provisioned automatically the first time a tag is created. Tags are matched by label, so call ListTags first and avoid creating one whose label duplicates an existing tag in the same set. Returns the new tag's id and its set's propertyDefinitionId, which you can pass straight to SetEntityProperty (add_option_ids) to apply the tag to an item. Use this only to create a brand-new tag; to apply an existing tag to an item, use ListTags then SetEntityProperty instead."
)]
#[serde(rename_all = "snake_case")]
pub struct CreateTag {
    #[schemars(description = "The tag's label, e.g. \"Urgent\" or \"Follow-up\".")]
    pub label: String,

    #[schemars(
        description = "The tag's color, chosen from the fixed tag palette. Pick a distinct, sensible color for the label."
    )]
    pub color: TagColor,

    #[schemars(
        description = "Which set to add the tag to: \"personal\" for the user's own private tags (the default), or \"team\" for their team's shared tags. \"team\" requires the user to belong to a team."
    )]
    #[serde(default = "default_tag_scope")]
    pub scope: TagScope,
}

/// Response from the [`CreateTag`] tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagResponse {
    /// The new tag's option id. Use it with SetEntityProperty to apply or remove the tag.
    pub id: Uuid,
    /// The tag's label.
    pub label: String,
    /// The tag's color, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The tag set's property definition id. Use it as propertyDefinitionId with SetEntityProperty.
    pub property_definition_id: Uuid,
    /// Whether the tag was added to the personal or team set.
    pub scope: TagScope,
    /// Human-readable summary.
    pub summary: String,
}

#[async_trait]
impl<T, A> AsyncTool<PropertiesToolContext<T, A>> for CreateTag
where
    T: PropertiesService,
    A: EntityAccessService,
{
    type Output = CreateTagResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, scope=?self.scope), err)]
    async fn call(
        &self,
        service_context: ServiceContext<PropertiesToolContext<T, A>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Create tag");

        let (domain_scope, team) = match self.scope {
            TagScope::Personal => (DomainTagScope::User, None),
            TagScope::Team => {
                let receipt = caller_team_receipt_opt(&service_context, &request_context)
                    .await?
                    .ok_or_else(|| ToolCallError {
                        description: "You are not on a team, so you can't create a team tag. Create a personal tag instead.".to_string(),
                        internal_error: anyhow::anyhow!("team scope without team membership"),
                    })?;
                (DomainTagScope::Team, Some(receipt))
            }
        };
        let team_ref = team.as_ref();
        let user_id = &request_context.user_id;

        let tag_set = service_context
            .service
            .ensure_tag_set(user_id, team_ref, domain_scope)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to prepare the tag set: {e}"),
                internal_error: e.into(),
            })?;

        let definition = tag_set.definition.ok_or_else(|| ToolCallError {
            description: "Failed to prepare the tag set.".to_string(),
            internal_error: anyhow::anyhow!("ensure_tag_set returned no definition"),
        })?;

        let request = AddPropertyOptionRequest::SelectString {
            option: AddStringOptionRequest {
                display_order: tag_set.options.len() as i32,
                value: self.label.clone(),
                color: Some(self.color.hex().to_string()),
            },
        };

        let option = service_context
            .service
            .add_property_option(user_id, team_ref, definition.id, &request)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to create tag: {e}"),
                internal_error: e.into(),
            })?;

        let label = match option.value {
            PropertyOptionValue::String(s) => s,
            PropertyOptionValue::Number(n) => n.to_string(),
        };
        let scope_word = match self.scope {
            TagScope::Personal => "personal",
            TagScope::Team => "team",
        };
        let summary = format!("Created the {scope_word} tag \"{label}\".");

        Ok(CreateTagResponse {
            id: option.id,
            label,
            color: option.color,
            property_definition_id: definition.id,
            scope: self.scope,
            summary,
        })
    }
}
