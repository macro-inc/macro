//! DeleteCalendarEvent tool for removing calendar events.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{CalendarToolContext, CopyChange, confirm_copy, mutation_tool_error};
use crate::domain::ports::{
    CalendarDeletionScope, CalendarMutationService, CalendarOccurrenceService, MeetingLinkProvider,
};

/// How much of a recurring series a deletion removes.
#[derive(Debug, Deserialize, JsonSchema, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeletionScopeInput {
    /// The entire event or series.
    #[default]
    All,
    /// One occurrence of a recurring series.
    ThisEvent,
    /// One occurrence and everything after it.
    ThisAndFollowing,
}

/// Response from the DeleteCalendarEvent tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCalendarEventResponse {
    /// The id of the deleted event.
    pub event_id: uuid::Uuid,
    /// A human-readable confirmation of what was removed.
    pub summary: String,
}

/// Delete a calendar event.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteCalendarEvent",
    description = "\
Delete an event from the user's calendar.\n\
\n\
A meeting on more than one of the user's inboxes is one ListCalendarEvents entry per inbox. \
Before deleting any of them, ask the user which inbox's copy to delete, then pass that \
copy's `inbox`. Never choose between the user's inboxes yourself, whatever they look like: \
a test, secondary or unfamiliar address is still the user's own inbox. Skip the question \
only when the user already named the inbox, or when only one copy can be deleted \
(`isReadOnly` false); then delete that copy and say why. Without `inbox` the tool refuses, \
lists each copy and gives the question to ask. Deleting the copy the user organizes cancels \
the meeting for every guest. Deleting a copy where they are a guest takes the meeting off \
that inbox's calendar: on Google it also declines the invitation and tells the organizer, \
while on Outlook the organizer is not told and still sees the invitation unanswered.\n\
\n\
The deletion is written to the calendar provider immediately and attendees are notified, so \
confirm with the user before deleting — it cannot be undone. Get the `eventId` from \
ListCalendarEvents.\n\
\n\
For recurring events, `scope` controls how much is removed: \"all\" (default) removes the \
whole series, \"this_event\" removes one occurrence, and \"this_and_following\" ends the \
series from an occurrence onward. The scoped variants require `recurrenceId` from the \
targeted occurrence's ListCalendarEvents entry."
)]
pub struct DeleteCalendarEvent {
    /// Event to delete.
    #[schemars(description = "The event's id, from ListCalendarEvents or CreateCalendarEvent.")]
    pub event_id: uuid::Uuid,

    /// Calendar whose copy of the event is deleted.
    #[schemars(
        description = "The `calendarId` of the copy to delete, from the `copies` of its \
                       ListCalendarEvents entry, for an event synced from more than one \
                       calendar. Omit to delete the event's primary copy."
    )]
    #[serde(default)]
    pub calendar_id: Option<uuid::Uuid>,

    /// Inbox holding the copy to delete.
    #[schemars(
        description = "The `inbox` of the copy to delete, from its ListCalendarEvents entry. \
                       Required when the meeting is on more than one of the user's inboxes: \
                       the tool refuses without it and lists each copy. It must be the inbox \
                       holding the copy `eventId` names."
    )]
    #[serde(default)]
    pub inbox: Option<String>,

    /// Deletion scope.
    #[schemars(
        description = "How much of a recurring series to remove: \"all\" (default), \
                       \"this_event\", or \"this_and_following\". Non-recurring events use \
                       \"all\"."
    )]
    #[serde(default)]
    pub scope: DeletionScopeInput,

    /// Occurrence key for scoped deletions.
    #[schemars(
        description = "The `recurrenceId` of the targeted occurrence, from its \
                       ListCalendarEvents entry. Required for \"this_event\" and \
                       \"this_and_following\"."
    )]
    #[serde(default)]
    pub recurrence_id: Option<String>,
}

impl ToolAnnotated for DeleteCalendarEvent {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Delete calendar event");
}

#[async_trait]
impl<M, O, L> AsyncTool<CalendarToolContext<M, O, L>> for DeleteCalendarEvent
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    type Output = DeleteCalendarEventResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O, L>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(
            event_id=%self.event_id,
            calendar_id=?self.calendar_id,
            scope=?self.scope,
            inbox_confirmed=self.inbox.is_some(),
            "Delete calendar event"
        );

        let requester_id = request_context.user_id.to_string();
        let scoped_occurrence = |kind: &'static str| {
            self.recurrence_id.clone().ok_or_else(|| ToolCallError {
                description: format!(
                    "A {kind} deletion requires `recurrenceId` — use the occurrence's \
                     `recurrenceId` from ListCalendarEvents."
                ),
                internal_error: anyhow::anyhow!("scoped deletion without recurrenceId"),
            })
        };
        let (scope, removed) = match self.scope {
            DeletionScopeInput::All => (CalendarDeletionScope::All, "the event"),
            DeletionScopeInput::ThisEvent => (
                CalendarDeletionScope::ThisEvent {
                    recurrence_id: scoped_occurrence("this_event")?,
                },
                "one occurrence of the event",
            ),
            DeletionScopeInput::ThisAndFollowing => (
                CalendarDeletionScope::ThisAndFollowing {
                    recurrence_id: scoped_occurrence("this_and_following")?,
                },
                "the occurrence and all that follow it",
            ),
        };

        confirm_copy(
            &*service_context.occurrences,
            &requester_id,
            self.event_id,
            self.inbox.as_deref(),
            CopyChange::Delete,
        )
        .await?;
        service_context
            .mutations
            .delete_event(&requester_id, self.event_id, self.calendar_id, scope)
            .await
            .map_err(|error| mutation_tool_error("delete the calendar event", error))?;

        Ok(DeleteCalendarEventResponse {
            event_id: self.event_id,
            summary: format!("Deleted {removed}."),
        })
    }
}
