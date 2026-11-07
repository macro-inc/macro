//! DeleteCallRecord tool for permanently deleting a finished call.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::models::EntityType;
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::{DeleteEntityPermanently, EntityMutationErrorCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{CallToolContext, call_access_error};
use crate::domain::ports::CallService;

/// Permanently delete a finished call.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteCallRecord",
    description = "Permanently delete a finished call with its recording and transcript, as Delete on a call does. This cannot be undone. Requires edit access to the call; calls still in progress cannot be deleted. Use only when the user explicitly asks to delete a call."
)]
pub struct DeleteCallRecord {
    /// The call to delete.
    #[schemars(description = "The id of the call to delete.")]
    pub call_id: Uuid,
}

/// The deleted call.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCallRecordResponse {
    /// The deleted call.
    pub call_id: Uuid,
}

impl ToolAnnotated for DeleteCallRecord {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Delete call").with_idempotent();
}

#[async_trait]
impl<CSvc, ESvc> AsyncTool<CallToolContext<CSvc, ESvc>> for DeleteCallRecord
where
    CSvc: CallService + DeleteEntityPermanently,
    ESvc: EntityAccessService,
{
    type Output = DeleteCallRecordResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, call_id=%self.call_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CallToolContext<CSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let entity = EntityType::Call.with_entity_string(self.call_id.to_string());
        let receipt = service_context
            .entity_access_service
            .generate_entity_access_receipt::<CSvc::Receipt>(
                &request_context.user_id,
                None,
                &entity.entity_id,
                entity.entity_type,
            )
            .await
            .map_err(call_access_error)?;
        service_context
            .service
            .delete_entity_permanently(entity, receipt)
            .await
            .map_err(|code| {
                let description = match code {
                    EntityMutationErrorCode::Conflict(_) => {
                        "the call is still in progress; only finished calls can be deleted"
                    }
                    EntityMutationErrorCode::Forbidden(_) => {
                        "you need edit access to the call to delete it"
                    }
                    EntityMutationErrorCode::NotFound(_) => "call not found",
                    _ => "failed to delete the call",
                };
                ToolCallError {
                    description: description.to_string(),
                    internal_error: anyhow::anyhow!("delete call failed: {code:?}"),
                }
            })?;

        Ok(DeleteCallRecordResponse {
            call_id: self.call_id,
        })
    }
}
