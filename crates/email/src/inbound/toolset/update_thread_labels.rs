//! UpdateThreadLabels tool for adding or removing a label from all messages in a thread.

use crate::domain::models::{LinkLabel, UserProvider, mailbox_action::MailboxAction};
use crate::domain::ports::{EmailService, GmailTokenProvider};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
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
Name the label with exactly one of `label` or `label_id`. `label` is a system label \
(INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM) or a custom label's display name, \
matched in the thread's own inbox, so it works across inboxes without a lookup. \
`label_id` is a UUID from ListLabels. Pass `add=true` to apply or `add=false` to remove. \
Each call modifies one label — to do multiple changes on the same thread (e.g. archive \
AND mark read), call this tool once per label.\n\
\n\
Common operations:\n\
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
In an Outlook inbox the same system label names set the matching mailbox state (archive, read, \
flag, trash, junk); IMPORTANT has no Outlook equivalent, and other names are Outlook categories.\n\
\n\
`thread_id` is the email thread UUID (the same id returned by ListEntities, search results, \
or GetThread). `label_id` is the UUID returned by ListLabels — NOT the label name; pass a \
name in `label` instead."
)]
pub struct UpdateThreadLabels {
    /// The ID of the email thread to modify. Same UUID returned by ListEntities, search, or GetThread.
    pub thread_id: Uuid,
    /// The UUID of the label to add or remove, from ListLabels. Omit when passing `label`.
    #[serde(default)]
    pub label_id: Option<Uuid>,
    /// The label's name instead of its id: a system label (INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM) or a custom label's display name, matched in the thread's inbox. Omit when passing `label_id`.
    #[serde(default)]
    pub label: Option<String>,
    /// Whether to add (true) or remove (false) the label from every message in the thread.
    pub add: bool,
}

/// The Outlook mailbox state a system label stands for: `None` for other
/// labels (Outlook categories), an error for one Outlook has no equivalent of.
pub(crate) fn outlook_mailbox_state(
    label: &str,
    add: bool,
) -> Option<Result<MailboxAction, ToolCallError>> {
    let state = match label.trim().to_ascii_uppercase().as_str() {
        "INBOX" => MailboxAction::Archived(!add),
        "UNREAD" => MailboxAction::Read(!add),
        "STARRED" => MailboxAction::Flagged(add),
        "TRASH" => MailboxAction::Trashed(add),
        "SPAM" => MailboxAction::Junk(add),
        "IMPORTANT" => {
            return Some(Err(ToolCallError {
                description: "Outlook has no Important label; flag the email instead.".into(),
                internal_error: anyhow::anyhow!("IMPORTANT on an Outlook thread"),
            }));
        }
        _ => return None,
    };
    Some(Ok(state))
}

/// What setting a system label did, for the tool's summary.
fn outlook_done(label: &str, add: bool) -> &'static str {
    match (label.trim().to_ascii_uppercase().as_str(), add) {
        ("INBOX", false) => "Archived",
        ("INBOX", true) => "Moved back to the inbox",
        ("UNREAD", false) => "Marked as read",
        ("UNREAD", true) => "Marked as unread",
        ("STARRED", true) => "Flagged",
        ("STARRED", false) => "Unflagged",
        ("TRASH", true) => "Moved to trash",
        ("SPAM", true) => "Moved to junk",
        _ => "Updated",
    }
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

impl ToolAnnotated for UpdateThreadLabels {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Update thread labels");
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
        label_id=?self.label_id,
        add=%self.add,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Update thread labels");

        // Resolve the inbox from the thread itself rather than defaulting to the
        // caller's primary inbox, so label operations work on threads that live
        // in a delegated or secondary inbox.
        let link = service_context
            .service
            .get_owned_link_for_thread(
                MacroUserIdStr((*request_context.user_id).clone()),
                self.thread_id,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to resolve inbox for thread: {e}"),
                internal_error: e.into(),
            })?
            .ok_or_else(|| ToolCallError {
                description: "No accessible inbox owns this thread.".to_string(),
                internal_error: anyhow::anyhow!("no owned link for thread"),
            })?;

        // Outlook has no system labels: archive, read, flag, trash and junk
        // are mailbox states there, so set the state instead.
        if link.provider == UserProvider::Outlook
            && let Some(name) = self.label.as_deref()
            && let Some(state) = outlook_mailbox_state(name, self.add)
        {
            let action = state?;
            service_context
                .service
                .change_thread_mailbox_state(
                    MacroUserIdStr((*request_context.user_id).clone()),
                    self.thread_id,
                    action,
                )
                .await
                .map_err(|e| ToolCallError {
                    description: format!("Failed to update the thread: {e}"),
                    internal_error: e.into(),
                })?;
            return Ok(UpdateThreadLabelsResponse {
                successful_count: 1,
                failed_count: 0,
                summary: format!("{} the thread.", outlook_done(name, self.add)),
            });
        }

        let label_id = match (self.label_id, self.label.as_deref()) {
            (Some(id), None) => id,
            (None, Some(name)) => {
                let labels = service_context
                    .service
                    .list_labels(&link)
                    .await
                    .map_err(|e| ToolCallError {
                        description: format!("Failed to list the inbox's labels: {e}"),
                        internal_error: e.into(),
                    })?;
                LinkLabel::find(&labels, name)
                    .map(|label| label.id)
                    .ok_or_else(|| ToolCallError {
                        description: format!(
                            "No label named \"{}\" in this thread's inbox. Call ListLabels to see its labels.",
                            name.trim()
                        ),
                        internal_error: anyhow::anyhow!("unknown label name"),
                    })?
            }
            _ => {
                return Err(ToolCallError {
                    description: "Pass exactly one of `label` or `label_id`.".to_string(),
                    internal_error: anyhow::anyhow!("label_id and label are exclusive"),
                });
            }
        };

        let result = service_context
            .service
            .update_thread_labels(&link, self.thread_id, label_id, self.add)
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
