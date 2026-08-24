//! DeleteCalendarEvent tool for removing calendar events.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{CalendarToolContext, mutation_tool_error};
use crate::domain::ports::{
    CalendarDeletionScope, CalendarMutationService, CalendarOccurrenceService,
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
Delete an event from the user's calendar. The deletion is written to Google immediately and \
attendees are notified, so confirm with the user before deleting — it cannot be undone. Get \
the `eventId` from ListCalendarEvents.\n\
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
impl<M, O> AsyncTool<CalendarToolContext<M, O>> for DeleteCalendarEvent
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    type Output = DeleteCalendarEventResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Delete calendar event");

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

        service_context
            .mutations
            .delete_event(&requester_id, self.event_id, scope)
            .await
            .map_err(|error| mutation_tool_error("delete the calendar event", error))?;

        Ok(DeleteCalendarEventResponse {
            event_id: self.event_id,
            summary: format!("Deleted {removed}."),
        })
    }
}
