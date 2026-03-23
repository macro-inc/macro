//! UpdateThreadLabels tool for adding or removing a label from all messages in a thread.

use crate::domain::ports::{EmailService, GmailTokenProvider};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::EmailToolContext;

/// Add or remove a label from all messages in an email thread.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "UpdateThreadLabels",
    description = "Add or remove a label from all messages in an email thread. Use ListLabels first to get valid label IDs. Set `add` to true to apply the label, or false to remove it."
)]
pub struct UpdateThreadLabels {
    /// The ID of the email thread to modify.
    pub thread_id: Uuid,
    /// The ID of the label to add or remove. Use ListLabels to get valid label IDs.
    pub label_id: Uuid,
    /// Whether to add (true) or remove (false) the label.
    pub add: bool,
}

/// Response from the UpdateThreadLabels tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThreadLabelsResponse {
    /// The number of messages successfully updated.
    pub successful_count: usize,
    /// The number of messages that failed to update.
    pub failed_count: usize,
    /// A human-readable summary of the operation.
    pub summary: String,
}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for UpdateThreadLabels
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = UpdateThreadLabelsResponse;

    #[tracing::instrument(skip_all, fields(
        user_id=?request_context.user_id,
        thread_id=%self.thread_id,
        label_id=%self.label_id,
        add=%self.add,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Update thread labels");

        let link = service_context
            .resolve_link((*request_context.user_id).clone())
            .await?;

        let access_token = service_context.resolve_access_token(&link).await?;

        let result = service_context
            .service
            .update_thread_labels(
                &access_token,
                &link,
                self.thread_id,
                self.label_id,
                self.add,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to update thread labels: {e}"),
                internal_error: e.into(),
            })?;

        let action = if self.add { "added to" } else { "removed from" };
        let successful_count = result.successful_ids.len();
        let failed_count = result.failed_ids.len();

        let summary = if failed_count == 0 {
            format!("Label successfully {action} {successful_count} message(s).")
        } else {
            format!(
                "Label {action} {successful_count} message(s), but failed for {failed_count} message(s)."
            )
        };

        Ok(UpdateThreadLabelsResponse {
            successful_count,
            failed_count,
            summary,
        })
    }
}
