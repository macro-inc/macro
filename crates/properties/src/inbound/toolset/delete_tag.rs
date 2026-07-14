//! DeleteTag tool for permanently removing a tag from the caller's set.

use crate::domain::service::PropertiesService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{PropertiesToolContext, caller_team_receipt_opt};

/// Permanently delete a tag from the caller's personal or team set.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "DeleteTag",
    description = "Permanently delete a tag from the user's personal set or their team's shared set. This removes the tag from every item it is currently applied to, so it is destructive and cannot be undone — confirm with the user first. Both ids come from a ListTags result: `id` is the tag's option id, and `property_definition_id` is the propertyDefinitionId of the set that contains it. To simply remove a tag from a single item without deleting the tag itself, use SetEntityProperty with remove_option_ids instead."
)]
#[serde(rename_all = "snake_case")]
pub struct DeleteTag {
    #[schemars(description = "The tag's option id (the `id` field from a ListTags result).")]
    pub id: Uuid,

    #[schemars(
        description = "The tag set's property definition id (the `propertyDefinitionId` of the ListTags set that contains this tag)."
    )]
    pub property_definition_id: Uuid,
}

/// Response from the [`DeleteTag`] tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTagResponse {
    /// Whether the tag was deleted.
    pub success: bool,
    /// Human-readable summary.
    pub message: String,
}

#[async_trait]
impl<T, A> AsyncTool<PropertiesToolContext<T, A>> for DeleteTag
where
    T: PropertiesService,
    A: EntityAccessService,
{
    type Output = DeleteTagResponse;

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
        tracing::info!("Delete tag");

        let team = caller_team_receipt_opt(&service_context, &request_context).await?;

        service_context
            .service
            .delete_property_option(
                &request_context.user_id,
                team.as_ref(),
                self.property_definition_id,
                self.id,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to delete tag: {e}"),
                internal_error: e.into(),
            })?;

        Ok(DeleteTagResponse {
            success: true,
            message: "Tag deleted successfully.".to_string(),
        })
    }
}
