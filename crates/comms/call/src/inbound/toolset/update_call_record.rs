//! UpdateCallRecord tool for renaming a call and sharing it with the team.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::models::{EditAccessLevel, EntityType};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{CallToolContext, call_access_error, call_error};
use crate::domain::models::EditCallRecordRequest;
use crate::domain::ports::CallService;

/// Change a call's name or team sharing.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UpdateCallRecord",
    description = "Rename a recorded call or change whether it is shared with the team, as the call's header menu does. Requires edit access to the call; only the call's creator can change team sharing on a finished call. Find calls with ListEntities or NameSearch."
)]
pub struct UpdateCallRecord {
    /// The call to change.
    #[schemars(description = "The id of the call.")]
    pub call_id: Uuid,
    /// New display name.
    #[schemars(
        description = "New display name for the call. An empty string clears the custom name. Omit to leave it unchanged."
    )]
    #[serde(default)]
    pub name: Option<String>,
    /// Team sharing.
    #[schemars(
        description = "True to share the call with the creator's team (view access), false to stop sharing it. Omit to leave it unchanged."
    )]
    #[serde(default)]
    pub share_with_team: Option<bool>,
}

/// The changed call.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCallRecordResponse {
    /// The changed call.
    pub call_id: Uuid,
    /// Human-readable result summary.
    pub summary: String,
}

impl ToolAnnotated for UpdateCallRecord {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Update call").with_idempotent();
}

#[async_trait]
impl<CSvc, ESvc> AsyncTool<CallToolContext<CSvc, ESvc>> for UpdateCallRecord
where
    CSvc: CallService,
    ESvc: EntityAccessService,
{
    type Output = UpdateCallRecordResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, call_id=%self.call_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CallToolContext<CSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.name.is_none() && self.share_with_team.is_none() {
            return Err(ToolCallError {
                description: "nothing to change: set name or shareWithTeam".to_string(),
                internal_error: anyhow::anyhow!("empty call record update"),
            });
        }
        let receipt = service_context
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &request_context.user_id,
                None,
                &self.call_id.to_string(),
                EntityType::Call,
            )
            .await
            .map_err(call_access_error)?;
        let name = self.name.as_deref().map(str::trim).map(str::to_string);
        service_context
            .service
            .edit_call_record(
                receipt,
                EditCallRecordRequest {
                    share_permission: None,
                    share_with_team: self.share_with_team,
                    custom_name: name.clone(),
                },
            )
            .await
            .map_err(call_error("update the call"))?;

        let mut changes = Vec::new();
        match name.as_deref() {
            Some("") => changes.push("cleared its custom name".to_string()),
            Some(name) => changes.push(format!("renamed it to `{name}`")),
            None => {}
        }
        match self.share_with_team {
            Some(true) => changes.push("shared it with the team".to_string()),
            Some(false) => changes.push("stopped sharing it with the team".to_string()),
            None => {}
        }
        Ok(UpdateCallRecordResponse {
            call_id: self.call_id,
            summary: format!("Updated the call: {}.", changes.join(" and ")),
        })
    }
}
