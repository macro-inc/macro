//! UpdateReminder tool for rescheduling, rewording, or completing a reminder.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

use super::{RemindersToolContext, ToolReminder, reminder_error, utc_conversion_note};
use crate::domain::models::{ReminderPatch, ReminderSchedule};
use crate::domain::ports::RemindersService;

/// Change one of the current user's reminders.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UpdateReminder",
    description = concat!(
        "\
Change one of the current user's reminders: reword it, move when it fires, or mark it done. \
Get the `reminderId` from ListReminders or CreateReminder.\n\
\n\
Pass only the fields you are changing; anything omitted is left alone. At least one must be \
given.\n\
\n\
- Snooze or reschedule: set `remindAt`\n\
- Mark done: `completed: true` — the user has dealt with it and it leaves their active list\n\
- Reopen: `completed: false`\n\
- Reword: set `description`\n\
\n\
Marking done is the normal way to clear a reminder the user has handled, and it is \
reversible: the reminder drops out of the default ListReminders results but is still there, \
readable with `completed: true` and restorable with `completed: false`. Reach for \
DeleteReminder only when the user wants the reminder not to exist; that cannot be undone.\n\
\n\
Two things this tool will not do. It cannot change what a reminder is attached to — create a \
new reminder and delete this one instead. And setting `remindAt` on a repeating reminder \
replaces the repetition with that single firing, so only do it if the user asked to stop it \
repeating.\n\
\n",
        utc_conversion_note!()
    )
)]
pub struct UpdateReminder {
    /// The reminder to change.
    #[schemars(description = "The id of the reminder to change.")]
    pub reminder_id: Uuid,

    /// Replacement description.
    #[schemars(description = "Replacement reminder text. Max 2000 characters.")]
    #[serde(default)]
    pub description: Option<String>,

    /// Replacement one-shot firing time.
    #[schemars(description = "Reschedule to this RFC 3339 timestamp in UTC (e.g. \
                       \"2026-08-08T14:00:00Z\"). Must be in the future — to move a reminder \
                       that has already fired, give it a new future time. Convert from the \
                       user's local timezone before sending; see \"Times are UTC\" in the tool \
                       description.")]
    #[serde(default)]
    pub remind_at: Option<DateTime<Utc>>,

    /// Mark the reminder as dealt with, or live again.
    #[schemars(
        description = "Mark the reminder as dealt with (true) or put it back on the active \
                       list (false)."
    )]
    #[serde(default)]
    pub completed: Option<bool>,
}

impl ToolAnnotated for UpdateReminder {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Update reminder");
}

#[async_trait]
impl<S, E> AsyncTool<RemindersToolContext<S, E>> for UpdateReminder
where
    S: RemindersService,
    E: EntityAccessService,
{
    type Output = ToolReminder;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        reminder_id = %self.reminder_id,
        completed = ?self.completed,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<RemindersToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Update reminder");

        let receipt = service_context
            .owner_receipt(&request_context.user_id, self.reminder_id)
            .await?;

        let patch = ReminderPatch {
            description: self.description.clone(),
            schedule: self
                .remind_at
                .map(|remind_at| ReminderSchedule::Once { remind_at }),
            // Not exposed: `enabled` is the dispatcher's switch and reads as a
            // second, subtly different way of saying "done". Two booleans that
            // both sound like "turn this off" is how a model picks the wrong
            // one. Rescheduling covers the case it would serve.
            enabled: None,
            completed: self.completed,
        };

        let reminder = service_context
            .service
            .update_reminder(receipt, patch)
            .await
            .map_err(reminder_error)?;

        Ok(ToolReminder::new(reminder, Utc::now()))
    }
}
