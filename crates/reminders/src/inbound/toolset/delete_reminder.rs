//! DeleteReminder tool for removing one of the current user's reminders.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{RemindersToolContext, reminder_error};
use crate::domain::ports::RemindersService;

/// Delete one of the current user's reminders.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteReminder",
    description = "\
Permanently delete one of the current user's reminders, along with any notification it \
already produced. Get the `reminderId` from ListReminders or CreateReminder.\n\
\n\
This cannot be undone, and it is not the usual way to clear a reminder. When the user has \
simply dealt with one, use UpdateReminder with `completed: true` instead: that takes it off \
their active list but keeps it, still readable with ListReminders `completed: true` and \
restorable with `completed: false`. Delete is for reminders they want gone rather than \
finished — one set by mistake, or for something that is no longer happening. If it is not \
clear which they mean, mark it done."
)]
pub struct DeleteReminder {
    /// The reminder to delete.
    #[schemars(description = "The id of the reminder to delete.")]
    pub reminder_id: Uuid,
}

impl ToolAnnotated for DeleteReminder {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Delete reminder");
}

/// Response from the DeleteReminder tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReminderResponse {
    /// The id of the reminder that was deleted.
    pub reminder_id: Uuid,
    /// A human-readable summary of the operation.
    pub summary: String,
}

#[async_trait]
impl<S, E> AsyncTool<RemindersToolContext<S, E>> for DeleteReminder
where
    S: RemindersService,
    E: EntityAccessService,
{
    type Output = DeleteReminderResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        reminder_id = %self.reminder_id,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<RemindersToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Delete reminder");

        let receipt = service_context
            .owner_receipt(&request_context.user_id, self.reminder_id)
            .await?;

        service_context
            .service
            .delete_reminder(receipt)
            .await
            .map_err(reminder_error)?;

        Ok(DeleteReminderResponse {
            reminder_id: self.reminder_id,
            summary: "Reminder deleted.".to_string(),
        })
    }
}
