//! UpdateThreadLabels tool for adding or removing a label from all messages in a thread.

use crate::domain::ports::{EmailService, GmailTokenProvider};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::EmailToolContext;

/// Add or remove a label from all messages in an email thread.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "UpdateThreadLabels",
    description = "\
Add or remove a single label from every message in a Gmail thread. In Gmail, nearly all \
inbox operations are just label add/remove operations, so this tool is the primitive for \
archiving, marking read/unread, starring, trashing, marking important/spam, and applying \
or removing custom labels.\n\
\n\
Workflow: call ListLabels first to discover the UUID `id` for the label name you need, \
then call this tool with that `label_id` plus the thread's `thread_id` and `add=true` \
(apply) or `add=false` (remove). Each call modifies one label — to do multiple changes \
on the same thread (e.g. archive AND mark read), call this tool once per label.\n\
\n\
Common operations (look up each system label's id via ListLabels first):\n\
- Archive: remove `INBOX` (add=false)\n\
- Move back to inbox: add `INBOX` (add=true)\n\
- Mark as read: remove `UNREAD` (add=false)\n\
- Mark as unread: add `UNREAD` (add=true)\n\
- Star: add `STARRED` (add=true) / Unstar: remove (add=false)\n\
- Move to trash: add `TRASH` (add=true) / Restore: remove (add=false)\n\
- Mark important: add `IMPORTANT` (add=true) / Mark unimportant: remove (add=false)\n\
- Report spam: add `SPAM` (add=true) / Not spam: remove (add=false)\n\
- Apply custom user label: add the label with that display name (add=true) / Remove: (add=false)\n\
\n\
`thread_id` is the email thread UUID (the same id returned by ListEntities, search results, \
or GetThread). `label_id` is the UUID returned by ListLabels — NOT the label name."
)]
pub struct UpdateThreadLabels {
    /// The ID of the email thread to modify. Same UUID returned by ListEntities, search, or GetThread.
    pub thread_id: Uuid,
    /// The UUID of the label to add or remove. Obtain this by calling ListLabels and looking up the label by name — do not pass the label name here.
    pub label_id: Uuid,
    /// Whether to add (true) or remove (false) the label from every message in the thread.
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
            .resolve_link(MacroUserIdStr((*request_context.user_id).clone()))
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
