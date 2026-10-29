//! CreateCalendarEvent tool for adding events to the user's calendar.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use rootcause::compat::boxed_error::IntoBoxedError;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{
    AttendeeInput, CalendarEventTypeInput, CalendarLabels, CalendarToolContext,
    EventRemindersInput, EventTimeInput, OutOfOfficeInput, ToolCalendarEvent,
    macro_call_create_tool_error, mutation_tool_error,
};
use crate::domain::{
    meeting_links::create_event_with_macro_call,
    models::{CalendarEventDraft, ConferenceChange, GuestPolicy},
    ports::{CalendarMutationService, CalendarOccurrenceService, MeetingLinkProvider},
};

/// Create a calendar event.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateCalendarEvent",
    description = "\
Prepare an event on the user's calendar, inviting any listed attendees through its connected \
provider. In Macro chat this tool opens an inline composer so the user can review, edit, and \
confirm the event; use the tool to present the proposal instead of asking for a redundant \
confirmation in prose. When the pending call is executed, the event is written to the calendar provider \
immediately and attendees receive invitations. Other clients should confirm attendee events \
before executing the call. Do NOT use it for a prompt that came from a channel or document \
thread — the context block names a conversation parent when it did, and there is no surface \
to review a draft in: write the event out in your reply, ask whether to create it, and use \
CreateConfirmedCalendarEvent once the user approves.\n\
\n\
The event lands on the user's primary calendar unless `calendarId` (from ListCalendars) \
targets another one. For recurring events pass RFC 5545 lines in `recurrenceLines`, e.g. \
[\"RRULE:FREQ=WEEKLY;BYDAY=MO\"]. Returns the created event with its `eventId` for later \
updates or deletion. Fails if the user has no writable calendar connected.\n\
\n\
For video conferencing pick at most one of `addMacroCall` (a Macro meeting link, the \
default choice for a Macro user's meeting) or `addConference` (Google Meet or Microsoft Teams, per calendar capabilities). \
A Macro call is created for the user, scheduled to the event's times, and its join link is \
appended to the event's description so every attendee's invitation carries it; it also \
becomes the event's `location` unless a physical `location` was supplied. The returned \
event's `macroCallUrl` holds the link.\n\
\n\
Set `eventType` to \"out_of_office\" to mark the user as out of office (e.g. \"mark me out \
of office Thursday\"). Out-of-office events must land on the user's primary calendar (omit \
`calendarId`), must be timed rather than all-day, and take no attendees or video \
conferencing (leave `addMacroCall` and `addConference` false); use `outOfOffice` to control \
whether conflicting meetings are auto-declined. The type cannot be changed afterward."
)]
pub struct CreateCalendarEvent {
    /// Display title.
    #[schemars(description = "The event title.")]
    pub title: String,

    /// Timed or all-day span.
    #[schemars(
        description = "When the event happens: a timed span with `kind` \"timed\" (startsAt, \
                       endsAt, optional timeZone) or whole days with `kind` \"allDay\" \
                       (startDate, exclusive endDate)."
    )]
    pub time: EventTimeInput,

    /// Optional event body.
    #[schemars(description = "Optional event body/description.")]
    #[serde(default)]
    pub description: Option<String>,

    /// Optional location label.
    #[schemars(description = "Optional physical or virtual location label.")]
    #[serde(default)]
    pub location: Option<String>,

    /// Attendees to invite.
    #[schemars(
        description = "Attendees to invite by email. They are notified by the calendar provider as \
                       soon as the event is created. Omit for a solo event."
    )]
    #[serde(default)]
    pub attendees: Vec<AttendeeInput>,

    /// Recurrence properties.
    #[schemars(
        description = "Raw RFC 5545 recurrence lines (RRULE, RDATE, EXDATE), e.g. \
                       [\"RRULE:FREQ=WEEKLY;BYDAY=MO,WE\"]. Omit for a one-off event."
    )]
    #[serde(default)]
    pub recurrence_lines: Vec<String>,

    /// Calendar to create the event on.
    #[schemars(
        description = "Calendar to create the event on, from ListCalendars. Omit to use the \
                       user's primary calendar."
    )]
    #[serde(default)]
    pub calendar_id: Option<uuid::Uuid>,

    /// Reminder configuration.
    #[schemars(
        description = "Reminder configuration for the event. Omit to use the selected calendar's defaults."
    )]
    #[serde(default)]
    pub reminders: Option<EventRemindersInput>,

    /// Whether to attach a Macro meeting link.
    #[schemars(
        description = "Attach a freshly created Macro call to the event: a Macro meeting link \
                       scheduled to the event's times, written into the event's location and \
                       description. Mutually exclusive with `addConference`."
    )]
    #[serde(default)]
    pub add_macro_call: bool,

    /// Whether to attach the calendar provider's meeting conference.
    #[schemars(
        description = "Attach a conference supported by this calendar: Google Meet or Microsoft Teams. Check ListCalendars capabilities first."
    )]
    #[serde(default, alias = "addGoogleMeet")]
    pub add_conference: bool,

    /// Kind of event to create.
    #[schemars(
        description = "The kind of event: \"default\" for a regular event (the default), or \
                       \"out_of_office\" to mark the user as out of office. Out-of-office \
                       events must be timed, on the primary calendar, and with no attendees."
    )]
    #[serde(default)]
    pub event_type: CalendarEventTypeInput,

    /// Out-of-office decline behavior.
    #[schemars(
        description = "Out-of-office decline behavior, used only when eventType is \
                       \"out_of_office\". Omit to just block the time; set \
                       `autoDeclineMode` to \"decline_all\" or \"decline_new_only\" to have \
                       the calendar integration decline conflicting meetings, optionally with a `declineMessage`."
    )]
    #[serde(default)]
    pub out_of_office: Option<OutOfOfficeInput>,

    /// What guests may do with the event.
    #[schemars(
        description = "What guests may do: `canModify` (change the event; implies \
                       `canInviteOthers`), `canInviteOthers` and `canSeeOtherGuests`. Omit for \
                       the defaults: guests may invite others and see the guest list but not \
                       modify the event. Google calendars only; an Outlook calendar refuses it."
    )]
    #[serde(default)]
    pub guest_policy: Option<GuestPolicy>,
}

impl ToolAnnotated for CreateCalendarEvent {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Create calendar event").with_open_world();
}

#[async_trait]
impl<M, O, L> AsyncTool<CalendarToolContext<M, O, L>> for CreateCalendarEvent
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    type Output = ToolCalendarEvent;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O, L>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(
            calendar_id=?self.calendar_id,
            attendee_count = self.attendees.len(),
            add_conference = self.add_conference,
            add_macro_call = self.add_macro_call,
            "Create calendar event"
        );

        if self.add_macro_call && self.add_conference {
            return Err(ToolCallError {
                description: "`addMacroCall` and `addConference` are mutually exclusive; pick \
                              one kind of video conferencing."
                    .to_string(),
                internal_error: anyhow::Error::from_boxed(
                    rootcause::report!("both Macro call and provider conference requested")
                        .into_boxed_error(),
                ),
            });
        }

        let requester_id = request_context.user_id.to_string();
        let out_of_office = match self.event_type {
            CalendarEventTypeInput::Default => {
                if self.out_of_office.is_some() {
                    return Err(ToolCallError {
                        description: "`outOfOffice` only applies when eventType is \
                                      \"out_of_office\"."
                            .to_string(),
                        internal_error: anyhow::Error::from_boxed(
                            rootcause::report!("out-of-office settings without the event type")
                                .into_boxed_error(),
                        ),
                    });
                }
                None
            }
            CalendarEventTypeInput::OutOfOffice => {
                Some(self.out_of_office.clone().unwrap_or_default().into())
            }
        };
        let draft = CalendarEventDraft {
            idempotency_key: None,
            title: self.title.clone(),
            description: self.description.clone(),
            location: self.location.clone(),
            time: self.time.clone().into(),
            attendees: self.attendees.iter().cloned().map(Into::into).collect(),
            recurrence_lines: self.recurrence_lines.clone(),
            visibility: None,
            transparency: None,
            reminders: self.reminders.clone().map(Into::into),
            conference: self
                .add_conference
                .then_some(ConferenceChange::ProviderDefault),
            out_of_office,
            guest_policy: self.guest_policy,
        };

        if self.add_macro_call {
            let created = create_event_with_macro_call(
                &*service_context.mutations,
                &*service_context.meeting_links,
                &requester_id,
                None,
                self.calendar_id,
                draft,
            )
            .await
            .map_err(macro_call_create_tool_error)?;
            let labels = CalendarLabels::load(&*service_context.mutations, &requester_id).await;
            return Ok(ToolCalendarEvent::from_event_with_macro_call(
                &created, &labels,
            ));
        }

        let event = service_context
            .mutations
            .create_event(&requester_id, None, self.calendar_id, draft)
            .await
            .map_err(|error| mutation_tool_error("create the calendar event", error))?;

        let labels = CalendarLabels::load(&*service_context.mutations, &requester_id).await;
        Ok(ToolCalendarEvent::from_event(&event, &labels))
    }
}
