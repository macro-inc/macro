//! EditTag tool for renaming or recoloring an existing tag.

use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_properties::api::UpdatePropertyOptionRequest;
use models_properties::service::property_option::PropertyOptionValue;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::tag_color::TagColor;
use super::{PropertiesToolContext, caller_team_receipt_opt};

/// Rename or recolor an existing tag.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "EditTag",
    description = "Rename or recolor an existing tag in the user's personal set or their team's shared set. The tag's id is preserved, so the change is reflected everywhere the tag is already applied — no item loses the tag. Provide the tag's `id` and its set's `property_definition_id` (both from ListTags) plus a new `label` and/or `color`; omit whichever you want to leave unchanged. This edits the tag itself; to change which tags are on a specific item, use SetEntityProperty instead."
)]
#[serde(rename_all = "snake_case")]
pub struct EditTag {
    #[schemars(description = "The tag's option id (the `id` field from a ListTags result).")]
    pub id: Uuid,

    #[schemars(
        description = "The tag set's property definition id (the `propertyDefinitionId` of the ListTags set that contains this tag)."
    )]
    pub property_definition_id: Uuid,

    #[schemars(description = "A new label for the tag. Omit to keep the current label.")]
    #[serde(default)]
    pub label: Option<String>,

    #[schemars(
        description = "A new color for the tag, chosen from the fixed tag palette. Omit to keep the current color."
    )]
    #[serde(default)]
    pub color: Option<TagColor>,
}

/// Response from the [`EditTag`] tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditTagResponse {
    /// The tag's option id (unchanged).
    pub id: Uuid,
    /// The tag's label after the edit.
    pub label: String,
    /// The tag's color after the edit, when set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The tag set's property definition id.
    pub property_definition_id: Uuid,
    /// Human-readable summary.
    pub summary: String,
}

#[async_trait]
impl<T, A> AsyncTool<PropertiesToolContext<T, A>> for EditTag
where
    T: PropertiesService,
    A: EntityAccessService,
{
    type Output = EditTagResponse;

    #[tracing::instrument(
        skip_all,
        fields(
            user_id=?request_context.user_id,
            property_definition_id=%self.property_definition_id,
            option_id=%self.id
        ),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<PropertiesToolContext<T, A>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Edit tag");

        if self.label.is_none() && self.color.is_none() {
            return Err(ToolCallError {
                description: "Provide a new label and/or color to edit the tag.".to_string(),
                internal_error: anyhow::anyhow!("edit tag with no changes"),
            });
        }

        let team = caller_team_receipt_opt(&service_context, &request_context).await?;

        let request = UpdatePropertyOptionRequest {
            value: self.label.clone(),
            color: self.color.map(|c| c.hex().to_string()),
            display_order: None,
        };

        let option = service_context
            .service
            .update_property_option(
                &request_context.user_id,
                team.as_ref(),
                self.property_definition_id,
                self.id,
                &request,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to edit tag: {e}"),
                internal_error: e.into(),
            })?;

        let label = match option.value {
            PropertyOptionValue::String(s) => s,
            PropertyOptionValue::Number(n) => n.to_string(),
        };
        let summary = format!("Updated tag \"{label}\".");

        Ok(EditTagResponse {
            id: option.id,
            label,
            color: option.color,
            property_definition_id: self.property_definition_id,
            summary,
        })
    }
}
