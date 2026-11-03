//! ReadCalendarEvent tool for reading one event by id, such as a mentioned
//! one, with the same visibility and fields as its mention preview card.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use rootcause::compat::boxed_error::IntoBoxedError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{CalendarLabels, CalendarToolContext, description_preview, time_fields};
use crate::domain::{
    join_requests::CalendarJoinRequestStatus,
    labels::off_schedule_summary,
    models::{
        CalendarMentionEvent, CalendarMentionPreview, CalendarMentionRequestItem,
        CalendarMentionViewerCopy,
    },
    ports::{CalendarMutationService, CalendarOccurrenceService, MeetingLinkProvider},
};

/// How the user holds the event, as its mention card says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarEventAccess {
    /// The meeting is on a calendar of the user's own schedule, as theirs:
    /// they organize it. `eventId` is that copy.
    OnYourCalendar,
    /// The meeting is on a calendar the user can see that is not part of
    /// their schedule (`calendarName`): someone else's, a delegated inbox's,
    /// or one of their own they left out. `eventId` is that copy.
    OnVisibleCalendar,
    /// The user is a guest on the meeting; `eventId` is their copy.
    Invited,
    /// The user added a snapshot of a shared meeting: a private copy that
    /// doesn't follow the organizer's changes, where an answer or a new guest
    /// would never reach the meeting. `eventId` is the snapshot.
    Snapshot,
    /// Someone shared their copy with a channel the user belongs to and the
    /// meeting is on none of the user's calendars: read-only, with no copy
    /// of the user's to change.
    SharedWithYou,
}

impl CalendarEventAccess {
    fn of(event: &CalendarMentionEvent, on_own_schedule: bool) -> Self {
        match (event.viewer_event_id, event.viewer_copy) {
            (None, _) => Self::SharedWithYou,
            (Some(_), Some(CalendarMentionViewerCopy::Snapshot)) => Self::Snapshot,
            (Some(_), Some(CalendarMentionViewerCopy::Invitation)) => Self::Invited,
            (Some(_), Some(CalendarMentionViewerCopy::Event) | None) if on_own_schedule => {
                Self::OnYourCalendar
            }
            (Some(_), Some(CalendarMentionViewerCopy::Event) | None) => Self::OnVisibleCalendar,
        }
    }
}

/// One calendar event, with the fields its mention preview card shows.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadCalendarEventResponse {
    /// How the user holds the event: on their calendar, on another calendar
    /// they can see, invited, as a snapshot, or only shared with them.
    pub access: CalendarEventAccess,
    /// Display name of the calendar holding `eventId`, the canonical copy's
    /// when several do, when known. It often says whose calendar it is.
    pub calendar_name: Option<String>,
    /// The user's own copy of the meeting, for UpdateCalendarEvent and
    /// DeleteCalendarEvent. It can differ from the id that was read, and is
    /// absent for an event that is only shared with the user.
    pub event_id: Option<Uuid>,
    /// Display title.
    pub title: String,
    /// Start of the instance read: RFC 3339 UTC instant, or YYYY-MM-DD for
    /// all-day events.
    pub start: String,
    /// Exclusive end: RFC 3339 UTC instant, or YYYY-MM-DD for all-day events.
    pub end: String,
    /// Whether the event covers whole days.
    pub is_all_day: bool,
    /// IANA time zone the event was scheduled in, when known.
    pub time_zone: Option<String>,
    /// Whether the event repeats.
    pub is_recurring: bool,
    /// Key of the instance read: the requested occurrence when it exists,
    /// otherwise the next upcoming one, else the latest past one, else the
    /// series start.
    pub recurrence_id: Option<String>,
    /// Location label, when set.
    pub location: Option<String>,
    /// Event body, truncated for brevity.
    pub description: Option<String>,
    /// Organizer email address, when known.
    pub organizer_email: Option<String>,
    /// Organizer display name, when known.
    pub organizer_name: Option<String>,
    /// Number of guests on the event.
    pub attendee_count: usize,
    /// For an event shared with the user, whether the person who shared it
    /// can add them as a guest. Always false for an event on their calendar.
    pub can_request_to_join: bool,
    /// For an event shared with the user, their request to join it, if they
    /// made one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub join_request_status: Option<CalendarJoinRequestStatus>,
    /// A human-readable summary of the event.
    pub summary: String,
}

impl ReadCalendarEventResponse {
    fn from_preview(event: CalendarMentionEvent, labels: &CalendarLabels) -> Self {
        let on_schedule = labels.on_schedule(event.viewer_calendar_ids.iter().copied());
        let access = CalendarEventAccess::of(&event, on_schedule == Some(true));
        let calendar_name = labels.calendar_name(event.viewer_calendar_ids.first().copied());
        let (start, end, is_all_day, time_zone) = time_fields(&event.time);
        let summary = match access {
            CalendarEventAccess::OnYourCalendar => {
                format!("{} is on the user's calendar.", event.title)
            }
            CalendarEventAccess::OnVisibleCalendar if on_schedule.is_none() => format!(
                "{} is on a calendar the user can see; whether it is theirs could not be checked.",
                event.title
            ),
            CalendarEventAccess::OnVisibleCalendar => {
                off_schedule_summary(&event.title, calendar_name.as_deref())
            }
            CalendarEventAccess::Invited => {
                format!(
                    "The user is invited to {}; it is on their calendar.",
                    event.title
                )
            }
            CalendarEventAccess::Snapshot => format!(
                "The user's calendar has a snapshot of {}: their own copy of a shared meeting, \
                 which doesn't follow the organizer's changes.",
                event.title
            ),
            CalendarEventAccess::SharedWithYou => format!(
                "{} was shared with a channel the user belongs to and is not on their calendar.",
                event.title
            ),
        };
        Self {
            access,
            calendar_name,
            event_id: event.viewer_event_id,
            title: event.title,
            start,
            end,
            is_all_day,
            time_zone,
            is_recurring: event.is_recurring,
            recurrence_id: event.occurrence_key,
            location: event.location,
            description: description_preview(event.description.as_deref()),
            organizer_email: event.organizer_email,
            organizer_name: event.organizer_name,
            attendee_count: event.attendee_count,
            can_request_to_join: event.can_request_to_join,
            join_request_status: event.join_request_status,
            summary,
        }
    }
}

/// Read one calendar event by id.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadCalendarEvent",
    description = "\
Read one calendar event by id: the `documentId` of a calendar event mention (`blockName` \
`calendar`) in a message, document, or email, or an `eventId` a calendar tool returned. \
Returns what the mention's preview card shows: title, time, location, description \
(truncated), organizer, guest count, and whether it repeats. ReadContent and ReadMetadata \
read documents only; use this tool for calendar events.\n\
\n\
`access` says how the user holds the meeting, as the card does. `on_your_calendar`: their own \
event, on a calendar of their schedule. `on_visible_calendar`: it is on a calendar they can see \
that is not part of their schedule, named by `calendarName`, which may be a colleague's: never \
call it theirs, say whose it is when the name shows that, and otherwise say you cannot tell. \
`invited`: they are a guest. \
`snapshot`: a private copy they added of a shared meeting, which doesn't follow the organizer's \
changes and where an answer or a new guest would never reach the meeting. In these four, \
`eventId` is the user's copy for UpdateCalendarEvent and DeleteCalendarEvent. \
`shared_with_you`: someone shared their copy with a channel the user belongs to and the meeting \
is on none of the user's calendars. The event is then read-only for the user; \
AddSharedCalendarEvent adds a snapshot of it, and `canRequestToJoin` and `joinRequestStatus` say \
whether they can ask the person who shared it to add them as a guest, which they do from the \
event's card. To read one instance of a recurring event, pass the mention's `occurrenceKey` \
block param."
)]
pub struct ReadCalendarEvent {
    /// Calendar event id.
    #[schemars(
        description = "Calendar event id: a calendar mention's documentId, or an eventId from a calendar tool."
    )]
    pub event_id: Uuid,
    /// Occurrence of a recurring event to read.
    #[schemars(
        description = "Occurrence to read for a recurring event: the mention's occurrenceKey block param, or a recurrenceId from ListCalendarEvents. Omit to read the next upcoming instance, else the latest past one, else the series start."
    )]
    pub occurrence_key: Option<String>,
}

impl ToolAnnotated for ReadCalendarEvent {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read calendar event");
}

#[async_trait]
impl<M, O, L> AsyncTool<CalendarToolContext<M, O, L>> for ReadCalendarEvent
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    type Output = ReadCalendarEventResponse;

    #[tracing::instrument(skip_all, fields(event_id=%self.event_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O, L>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let requester_id = request_context.user_id.to_string();
        let previews = service_context
            .occurrences
            .mention_previews(
                &requester_id,
                vec![CalendarMentionRequestItem {
                    event_id: self.event_id,
                    occurrence_key: self.occurrence_key.clone(),
                }],
            )
            .await
            .map_err(|error| ToolCallError {
                description: "Failed to read the calendar event. Try again shortly.".to_string(),
                internal_error: anyhow::Error::from_boxed(error.into_boxed_error()),
            })?;
        match previews.into_iter().next() {
            Some(CalendarMentionPreview::Accessible(event)) => {
                let labels = CalendarLabels::load(&*service_context.mutations, &requester_id).await;
                Ok(ReadCalendarEventResponse::from_preview(*event, &labels))
            }
            Some(CalendarMentionPreview::NoAccess) => Err(not_readable(
                "The calendar event is not on any of the user's calendars and was not shared \
                 with a channel they belong to, so they cannot see it.",
            )),
            Some(CalendarMentionPreview::DoesNotExist) | None => Err(not_readable(
                "The calendar event no longer exists: it was deleted or cancelled, or the id is \
                 not a calendar event.",
            )),
        }
    }
}

fn not_readable(description: &str) -> ToolCallError {
    ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::anyhow!(description.to_string()),
    }
}
