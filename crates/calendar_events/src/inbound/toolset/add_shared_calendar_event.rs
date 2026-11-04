//! AddSharedCalendarEvent tool for adding a copy of an event shared with one
//! of the user's channels to their own Google calendar, as the event card's
//! Add to calendar does.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

use super::{CalendarLabels, CalendarToolContext, ToolCalendarEvent, mutation_tool_error};
use crate::domain::{
    models::{CalendarProvider, VisibleCalendar},
    ports::{CalendarMutationService, CalendarOccurrenceService, MeetingLinkProvider},
};

const ACTION: &str = "add the shared event to the calendar";

/// Add a copy of a channel-shared event to one of the user's calendars.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "AddSharedCalendarEvent",
    description = "\
Add a copy of a calendar event someone shared with one of the user's channels to one of the \
user's Google calendars, as `Add to calendar` on the event's card does. Use it for a calendar \
event mention (`blockName` `calendar`) whose meeting is not on the user's calendar; pass the \
mention's `documentId` as `eventId`.\n\
\n\
The copy is a snapshot, not an invitation: it keeps the real organizer and lists the user, \
accepted, as its only guest, while the meeting's other guests and its join link stay out. \
Nobody is notified, and the copy does not change when the organizer changes the meeting. The \
user can change only its reminders and availability, or delete it. To be added to the meeting \
itself, the user asks the person who shared it from the event's card.\n\
\n\
Only Google calendars take a copy. When the user has one writable Google calendar the copy goes \
there; when they have several, ask which one and pass its `calendarId` from ListCalendars. The \
result is the user's copy, whose `eventId` UpdateCalendarEvent and DeleteCalendarEvent accept. \
A meeting already on any of the user's calendars is refused on every calendar, so never offer \
to add it to another one."
)]
pub struct AddSharedCalendarEvent {
    /// Shared event to copy.
    #[schemars(
        description = "The shared event's id: the `documentId` of its calendar event mention."
    )]
    pub event_id: Uuid,

    /// Google calendar to add the copy to.
    #[schemars(
        description = "The `calendarId` of a writable Google calendar from ListCalendars. Omit \
                       when the user has only one; required when they have several."
    )]
    #[serde(default)]
    pub calendar_id: Option<Uuid>,
}

impl ToolAnnotated for AddSharedCalendarEvent {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Add shared event to calendar").with_open_world();
}

/// The calendars the event card offers: only a writable Google calendar that
/// a person maintains imports a copy under the meeting's own UID.
fn takes_copies(calendar: &VisibleCalendar) -> bool {
    calendar.is_writable
        && calendar.provider == CalendarProvider::Google
        && !calendar.is_subscription
}

fn refused(description: String) -> ToolCallError {
    ToolCallError {
        internal_error: anyhow::anyhow!(description.clone()),
        description,
    }
}

/// A named calendar, held to the card's choices.
fn named_target(calendars: &[VisibleCalendar], calendar_id: Uuid) -> Result<Uuid, ToolCallError> {
    if calendars
        .iter()
        .any(|calendar| calendar.id == calendar_id && takes_copies(calendar))
    {
        return Ok(calendar_id);
    }
    Err(refused(
        "That calendar can't take a copy: shared events can be added only to a writable Google \
         calendar the user keeps, not a subscribed one. Pick another from ListCalendars, or \
         suggest downloading the event's .ics file from its card."
            .to_string(),
    ))
}

/// The calendar a copy goes to when none was named: the only one that takes
/// copies, or a refusal that lists the choices to ask the user about.
fn only_target(calendars: &[VisibleCalendar]) -> Result<Uuid, ToolCallError> {
    let targets: Vec<&VisibleCalendar> = calendars
        .iter()
        .filter(|calendar| takes_copies(calendar))
        .collect();
    match targets.as_slice() {
        [] => Err(refused(
            "None of the user's calendars can take a copy: shared events can be added only to a \
             writable Google calendar. Suggest downloading the event's .ics file from its card."
                .to_string(),
        )),
        [target] => Ok(target.id),
        // Ids only: a refusal is traced, and Google names a primary calendar
        // after its owner's address. ListCalendars has the names to ask with.
        targets => {
            let choices = targets
                .iter()
                .map(|calendar| calendar.id.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            Err(refused(format!(
                "The user has several Google calendars that can take a copy. Ask which one, \
                 naming them from ListCalendars, and call again with its calendarId, one of: \
                 {choices}."
            )))
        }
    }
}

#[async_trait]
impl<M, O, L> AsyncTool<CalendarToolContext<M, O, L>> for AddSharedCalendarEvent
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    type Output = ToolCalendarEvent;

    #[tracing::instrument(skip_all, fields(event_id=%self.event_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O, L>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if !service_context.shared_event_copies {
            return Err(refused(
                "Adding a shared event to the user's calendar is not enabled for this deployment."
                    .to_string(),
            ));
        }
        let requester_id = request_context.user_id.to_string();
        let calendars = service_context
            .mutations
            .list_visible_calendars(&requester_id)
            .await
            .map_err(|error| mutation_tool_error(ACTION, error))?;
        let calendar_id = match self.calendar_id {
            Some(calendar_id) => named_target(&calendars, calendar_id)?,
            None => only_target(&calendars)?,
        };
        let copy = service_context
            .mutations
            .copy_shared_event(&requester_id, self.event_id, Some(calendar_id))
            .await
            .map_err(|error| mutation_tool_error(ACTION, error))?;
        Ok(ToolCalendarEvent::from_event(
            &copy,
            &CalendarLabels::from_calendars(calendars),
        ))
    }
}
