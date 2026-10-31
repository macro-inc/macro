//! AI toolset adapter for calendar events.
//!
//! Tools are thin: they convert tool inputs into domain calls on the
//! [`CalendarMutationService`] and [`CalendarOccurrenceService`] ports and
//! map domain errors to agent-readable failures. Authorization and business
//! policy live behind those ports, exactly as for the HTTP routers.

mod add_shared_calendar_event;
mod create_calendar_event;
mod create_confirmed_calendar_event;
mod delete_calendar_event;
mod list_calendar_events;
mod list_calendars;
mod read_calendar_event;
mod update_calendar_event;

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, ToolCallError};
use chrono::NaiveDate;
use chrono::{DateTime, Utc};
use rootcause::compat::boxed_error::IntoBoxedError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    copies::{CopyChange, check_copy},
    meeting_links::{CreateEventWithMacroCallError, EventWithMacroCall, MeetingLinkError},
    models::{
        CalendarAttendeeInput, CalendarEvent, EventReminderOverride, EventReminders, EventTime,
        OutOfOfficeAutoDeclineMode, OutOfOfficeProperties, VisibleCalendar,
    },
    ports::{
        CalendarMutationError, CalendarMutationService, CalendarOccurrenceService,
        MeetingLinkProvider,
    },
};

pub use add_shared_calendar_event::AddSharedCalendarEvent;
pub use create_calendar_event::CreateCalendarEvent;
pub use create_confirmed_calendar_event::CreateConfirmedCalendarEvent;
pub use delete_calendar_event::{
    DeleteCalendarEvent, DeleteCalendarEventResponse, DeletionScopeInput,
};
pub use list_calendar_events::{
    CalendarEventListItem, ListCalendarEvents, ListCalendarEventsResponse,
};
pub use list_calendars::{ListCalendars, ListCalendarsToolResponse, ToolCalendar};
pub use read_calendar_event::{CalendarEventAccess, ReadCalendarEvent, ReadCalendarEventResponse};
pub use update_calendar_event::{
    ConferenceChangeInput, RsvpResponseInput, UpdateCalendarEvent, UpdateScopeInput,
};

/// Service context for calendar AI tools.
pub struct CalendarToolContext<M, O, L>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    /// Write path: user-initiated mutations, written through to the provider.
    pub mutations: Arc<M>,
    /// Read path: bounded occurrence viewport queries.
    pub occurrences: Arc<O>,
    /// Macro meetings minted for events that carry a Macro call.
    pub meeting_links: Arc<L>,
    /// Whether AddSharedCalendarEvent adds copies of channel-shared events:
    /// the `ENABLE_CALENDAR_ADD_SHARED_EVENT` deployment switch, off unless
    /// set, like the event card's Add to calendar.
    pub shared_event_copies: bool,
}

impl<M, O, L> Clone for CalendarToolContext<M, O, L>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    fn clone(&self) -> Self {
        Self {
            mutations: Arc::clone(&self.mutations),
            occurrences: Arc::clone(&self.occurrences),
            meeting_links: Arc::clone(&self.meeting_links),
            shared_event_copies: self.shared_event_copies,
        }
    }
}

impl<M, O, L> CalendarToolContext<M, O, L>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    /// Create a calendar tool context from its ports. Hosts without a call
    /// service pass [`crate::domain::ports::UnavailableMeetingLinks`].
    pub fn new(mutations: Arc<M>, occurrences: Arc<O>, meeting_links: Arc<L>) -> Self {
        Self {
            mutations,
            occurrences,
            meeting_links,
            shared_event_copies: false,
        }
    }

    /// Let AddSharedCalendarEvent add copies of channel-shared events.
    pub fn with_shared_event_copies(self, enabled: bool) -> Self {
        Self {
            shared_event_copies: enabled,
            ..self
        }
    }
}

fn shared_calendar_toolset<M, O, L>() -> AsyncToolCollection<CalendarToolContext<M, O, L>>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    AsyncToolCollection::new()
        .add_tool::<ListCalendarEvents, CalendarToolContext<M, O, L>>()
        .add_tool::<ListCalendars, CalendarToolContext<M, O, L>>()
        .add_tool::<ReadCalendarEvent, CalendarToolContext<M, O, L>>()
        .add_tool::<UpdateCalendarEvent, CalendarToolContext<M, O, L>>()
        .add_tool::<DeleteCalendarEvent, CalendarToolContext<M, O, L>>()
        .add_tool::<AddSharedCalendarEvent, CalendarToolContext<M, O, L>>()
}

/// The full calendar toolset, for hosts that finish user tools: the deferring
/// `CreateCalendarEvent`, which a composer or review card confirms, beside
/// `CreateConfirmedCalendarEvent`, which creates on a confirmation the user
/// already gave in conversation. Both are always registered; the prompt
/// decides which fits the surface the prompt came from. Reads, updates,
/// deletions, and copies of shared events execute in the agent loop.
pub fn calendar_toolset<M, O, L>() -> AsyncToolCollection<CalendarToolContext<M, O, L>>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    shared_calendar_toolset()
        .add_user_tool::<CreateCalendarEvent, CalendarToolContext<M, O, L>>()
        .add_tool::<CreateConfirmedCalendarEvent, CalendarToolContext<M, O, L>>()
}

/// Create the calendar toolset for hosts without a composer — the MCP server
/// and the channel-mention bot.
///
/// These hosts receive the real create tool and apply their own confirmation
/// policy from its annotations rather than the chat-specific deferred flow,
/// which only the chat frontend can finish. `CreateConfirmedCalendarEvent`
/// is left out: it is for the in-process agent's conversation turns, and
/// here the plain tool already creates directly.
pub fn mcp_toolset<M, O, L>() -> AsyncToolCollection<CalendarToolContext<M, O, L>>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
    L: MeetingLinkProvider,
{
    shared_calendar_toolset().add_tool::<CreateCalendarEvent, CalendarToolContext<M, O, L>>()
}

/// The mutually exclusive time shape supplied to calendar tools.
#[derive(Debug, Clone, PartialEq, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum EventTimeInput {
    /// A clock-time event with absolute instants.
    #[serde(rename_all = "camelCase")]
    Timed {
        /// Inclusive start instant, RFC 3339 UTC (e.g. 2026-08-20T17:00:00Z).
        starts_at: DateTime<Utc>,
        /// Exclusive end instant, RFC 3339 UTC. Must be after the start.
        ends_at: DateTime<Utc>,
        /// IANA time zone the event was scheduled in (e.g.
        /// America/New_York). Recurring events expand in this zone.
        time_zone: Option<String>,
    },
    /// An all-day event spanning whole local dates.
    #[serde(rename_all = "camelCase")]
    AllDay {
        /// Inclusive local start date (YYYY-MM-DD).
        start_date: NaiveDate,
        /// Exclusive local end date (YYYY-MM-DD); the day after the last
        /// covered day, so a one-day event ends the next date.
        end_date: NaiveDate,
    },
}

impl From<EventTimeInput> for EventTime {
    fn from(input: EventTimeInput) -> Self {
        match input {
            EventTimeInput::Timed {
                starts_at,
                ends_at,
                time_zone,
            } => Self::Timed {
                starts_at,
                ends_at,
                time_zone,
            },
            EventTimeInput::AllDay {
                start_date,
                end_date,
            } => Self::AllDay {
                start_date,
                end_date,
            },
        }
    }
}

/// An attendee supplied to a calendar tool.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttendeeInput {
    /// Attendee email address.
    #[schemars(description = "The attendee's email address.")]
    pub email: String,
    /// Whether attendance is optional.
    #[schemars(
        description = "Whether attendance is optional for this attendee. Defaults to required."
    )]
    #[serde(default)]
    pub is_optional: bool,
}

impl From<AttendeeInput> for CalendarAttendeeInput {
    fn from(input: AttendeeInput) -> Self {
        Self {
            email: input.email,
            is_optional: input.is_optional,
            response_status: None,
        }
    }
}

/// One reminder override supplied to a calendar tool.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventReminderOverrideInput {
    /// Provider reminder method. `popup` creates a Macro notification.
    pub method: String,
    /// Minutes before the event start.
    pub minutes: u32,
}

impl From<EventReminderOverrideInput> for EventReminderOverride {
    fn from(input: EventReminderOverrideInput) -> Self {
        Self {
            method: input.method,
            minutes: input.minutes,
        }
    }
}

/// Reminder configuration supplied when creating a calendar event.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventRemindersInput {
    /// Whether the selected calendar's default reminders should apply.
    pub use_default: bool,
    /// Overrides used when calendar defaults are disabled.
    #[serde(default)]
    pub overrides: Vec<EventReminderOverrideInput>,
}

impl From<EventRemindersInput> for EventReminders {
    fn from(input: EventRemindersInput) -> Self {
        Self {
            use_default: input.use_default,
            overrides: input.overrides.into_iter().map(Into::into).collect(),
        }
    }
}

/// The kind of event a create tool call makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarEventTypeInput {
    /// A regular calendar event.
    #[default]
    Default,
    /// A Google out-of-office status event: primary calendar only, timed, no
    /// attendees, and Google shows the user as away and can auto-decline
    /// conflicting invitations.
    OutOfOffice,
}

/// How an out-of-office event handles conflicting invitations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AutoDeclineModeInput {
    /// Leave conflicting invitations alone.
    DeclineNone,
    /// Decline every conflicting invitation, existing and new.
    DeclineAll,
    /// Decline only invitations that arrive after the event is created.
    DeclineNewOnly,
}

impl From<AutoDeclineModeInput> for OutOfOfficeAutoDeclineMode {
    fn from(input: AutoDeclineModeInput) -> Self {
        match input {
            AutoDeclineModeInput::DeclineNone => Self::DeclineNone,
            AutoDeclineModeInput::DeclineAll => Self::DeclineAllConflictingInvitations,
            AutoDeclineModeInput::DeclineNewOnly => Self::DeclineOnlyNewConflictingInvitations,
        }
    }
}

/// Out-of-office decline behavior supplied to the calendar tools.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OutOfOfficeInput {
    /// How conflicting invitations are handled. Defaults to declining nothing,
    /// so the event only blocks time and shows the away status.
    #[serde(default)]
    pub auto_decline_mode: Option<AutoDeclineModeInput>,
    /// Message returned to organizers whose invitations are auto-declined.
    #[serde(default)]
    pub decline_message: Option<String>,
}

impl From<OutOfOfficeInput> for OutOfOfficeProperties {
    fn from(input: OutOfOfficeInput) -> Self {
        Self {
            auto_decline_mode: input.auto_decline_mode.map(Into::into).unwrap_or_default(),
            decline_message: input.decline_message,
        }
    }
}

/// An attendee of a calendar event, as returned by calendar tools.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolEventAttendee {
    /// Attendee email address.
    pub email: String,
    /// RSVP state: needs_action, accepted, declined, or tentative.
    pub response_status: String,
    /// Whether this attendee organized the event.
    pub is_organizer: bool,
    /// Whether attendance is optional.
    pub is_optional: bool,
}

/// A calendar event as returned by the create and update tools.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolCalendarEvent {
    /// Macro calendar event id, used by UpdateCalendarEvent and
    /// DeleteCalendarEvent.
    pub event_id: uuid::Uuid,
    /// Display title.
    pub title: String,
    /// Event start: RFC 3339 UTC instant, or YYYY-MM-DD for all-day events.
    pub start: String,
    /// Exclusive event end: RFC 3339 UTC instant, or YYYY-MM-DD for all-day
    /// events.
    pub end: String,
    /// Whether the event covers whole days.
    pub is_all_day: bool,
    /// IANA time zone the event was scheduled in, when known.
    pub time_zone: Option<String>,
    /// Location label, when set.
    pub location: Option<String>,
    /// Event body, truncated for brevity.
    pub description: Option<String>,
    /// Event status: confirmed, tentative, or cancelled.
    pub status: String,
    /// Whether the event recurs.
    pub is_recurring: bool,
    /// Raw RFC 5545 recurrence properties, when the event recurs.
    pub recurrence_lines: Vec<String>,
    /// Attendees, capped at 20; `attendee_count` has the full number.
    pub attendees: Vec<ToolEventAttendee>,
    /// Total number of attendees.
    pub attendee_count: usize,
    /// Organizer email address, when known.
    pub organizer_email: Option<String>,
    /// Conference join URL, when a conference is attached.
    pub conference_url: Option<String>,
    /// Join URL of the Macro call created with the event, when
    /// CreateCalendarEvent was asked for one.
    pub macro_call_url: Option<String>,
    /// Whether the user's calendar prohibits modifying this event.
    pub is_read_only: bool,
    /// Calendar the event belongs to, when known.
    pub calendar_id: Option<uuid::Uuid>,
    /// Display name of that calendar, when known.
    pub calendar_name: Option<String>,
    /// Connected inbox address syncing the calendar, when known. It stays the
    /// user's own address on a colleague's calendar, so it never says whose
    /// calendar it is.
    pub inbox: Option<String>,
    /// Whether the user organizes this event or is a guest on it, through
    /// that inbox; absent when they are neither, or can only write that
    /// calendar.
    pub my_role: Option<ToolEventRole>,
}

/// What the user is on one copy of an event, through the inbox holding it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolEventRole {
    /// The inbox organizes the event, or the event has no guests and is the
    /// user's own. Being able to write someone else's calendar is not this;
    /// `viewerCan` says what the user may do there.
    Organizer,
    /// The inbox is invited to the event.
    Guest,
}

impl ToolEventRole {
    /// The role of the copy's inbox, read the way clients read it: only the
    /// copy's own inbox row is `is_self`. `organize` says they may act as
    /// organizer, which writing someone else's calendar grants too, so it
    /// counts only on a calendar of their own schedule with no other
    /// organizer listed.
    fn of(event: &CalendarEvent, labels: &CalendarLabels) -> Option<Self> {
        let own_row = event.attendees.iter().find(|attendee| attendee.is_self);
        if own_row.is_some_and(|attendee| attendee.is_organizer) {
            return Some(Self::Organizer);
        }
        let other_organizer = event.attendees.iter().any(|attendee| attendee.is_organizer);
        if event.viewer_can.organize
            && !other_organizer
            && labels.event_on_schedule(event) == Some(true)
        {
            return Some(Self::Organizer);
        }
        own_row.map(|_| Self::Guest)
    }
}

/// The calendars the user can see, to name the calendar and inbox each
/// event copy belongs to.
#[derive(Default)]
struct CalendarLabels {
    by_calendar: HashMap<Uuid, VisibleCalendar>,
    inbox_by_link: HashMap<Uuid, String>,
}

impl CalendarLabels {
    /// Load the requester's visible calendars. Labels only describe a result,
    /// so a failure leaves them out rather than failing a call whose change
    /// may already have reached the provider.
    async fn load<M: CalendarMutationService>(mutations: &M, requester_id: &str) -> Self {
        let Ok(calendars) = mutations
            .list_visible_calendars(requester_id)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "failed to load calendar names for a tool result");
            })
        else {
            return Self::default();
        };
        Self::from_calendars(calendars)
    }

    /// Labels from calendars the tool already listed.
    fn from_calendars(calendars: Vec<VisibleCalendar>) -> Self {
        let inbox_by_link = calendars
            .iter()
            .map(|calendar| (calendar.email_link_id, calendar.email_address.clone()))
            .collect();
        let by_calendar = calendars
            .into_iter()
            .map(|calendar| (calendar.id, calendar))
            .collect();
        Self {
            by_calendar,
            inbox_by_link,
        }
    }

    fn calendar_name(&self, calendar_id: Option<Uuid>) -> Option<String> {
        calendar_id
            .and_then(|id| self.by_calendar.get(&id))
            .map(|calendar| calendar.name.clone())
    }

    /// Whether any of these calendars counts toward the user's busy time,
    /// when one is known. Availability counts each copy of an event, so one
    /// copy on the user's schedule is enough.
    fn on_schedule(&self, calendar_ids: impl IntoIterator<Item = Uuid>) -> Option<bool> {
        calendar_ids
            .into_iter()
            .filter_map(|id| self.by_calendar.get(&id))
            .map(|calendar| calendar.contributes_to_availability)
            .reduce(|left, right| left || right)
    }

    /// Whether a calendar holding this event is on the user's schedule.
    fn event_on_schedule(&self, event: &CalendarEvent) -> Option<bool> {
        let copies = event.sources.iter().map(|copy| copy.calendar_id);
        self.on_schedule(event.calendar_id.into_iter().chain(copies))
    }

    /// The inbox holding a copy: its calendar's inbox, else the inbox whose
    /// grant backs it.
    fn inbox(&self, calendar_id: Option<Uuid>, link_id: Option<Uuid>) -> Option<String> {
        calendar_id
            .and_then(|id| self.by_calendar.get(&id))
            .map(|calendar| calendar.email_address.clone())
            .or_else(|| link_id.and_then(|id| self.inbox_by_link.get(&id)).cloned())
    }
}

/// Make sure the agent chose which copy to change when the meeting is on
/// several of the user's inboxes (`copies::check_copy`): a refusal comes
/// back with each copy's inbox and role, so the agent asks the user instead
/// of picking one.
async fn confirm_copy<O: CalendarOccurrenceService>(
    occurrences: &O,
    requester_id: &str,
    event_id: Uuid,
    inbox: Option<&str>,
    change: CopyChange,
) -> Result<(), ToolCallError> {
    let copies = occurrences
        .meeting_copies(requester_id, event_id)
        .await
        .map_err(|error| ToolCallError {
            description: "Failed to check which of the user's inboxes hold this meeting. Try \
                          again shortly."
                .to_string(),
            internal_error: anyhow::Error::from_boxed(error.into_boxed_error()),
        })?;
    match check_copy(&copies, event_id, inbox, change) {
        None => Ok(()),
        Some(refusal) => Err(ToolCallError {
            description: refusal.message().to_string(),
            internal_error: anyhow::anyhow!("the call did not confirm which copy it changes"),
        }),
    }
}

const DESCRIPTION_PREVIEW_CHARS: usize = 280;
const ATTENDEES_SHOWN_MAX: usize = 20;

/// Truncate an event description to a context-friendly preview.
fn description_preview(description: Option<&str>) -> Option<String> {
    description.map(|description| {
        if description.chars().count() <= DESCRIPTION_PREVIEW_CHARS {
            description.to_string()
        } else {
            let preview: String = description
                .chars()
                .take(DESCRIPTION_PREVIEW_CHARS)
                .collect();
            format!("{preview}…")
        }
    })
}

/// Render an event time as start/end strings plus the all-day flag and zone.
fn time_fields(time: &EventTime) -> (String, String, bool, Option<String>) {
    match time {
        EventTime::Timed {
            starts_at,
            ends_at,
            time_zone,
        } => (
            starts_at.to_rfc3339(),
            ends_at.to_rfc3339(),
            false,
            time_zone.clone(),
        ),
        EventTime::AllDay {
            start_date,
            end_date,
        } => (start_date.to_string(), end_date.to_string(), true, None),
    }
}

impl ToolCalendarEvent {
    fn from_event(event: &CalendarEvent, labels: &CalendarLabels) -> Self {
        let (start, end, is_all_day, time_zone) = time_fields(&event.time);
        Self {
            event_id: event.id,
            title: event.title.clone(),
            start,
            end,
            is_all_day,
            time_zone,
            location: event.location.clone(),
            description: description_preview(event.description.as_deref()),
            status: event.status.as_str().to_string(),
            is_recurring: !event.recurrence_lines.is_empty(),
            recurrence_lines: event.recurrence_lines.clone(),
            attendees: event
                .attendees
                .iter()
                .take(ATTENDEES_SHOWN_MAX)
                .map(|attendee| ToolEventAttendee {
                    email: attendee.email.clone(),
                    response_status: attendee.response_status.as_str().to_string(),
                    is_organizer: attendee.is_organizer,
                    is_optional: attendee.is_optional,
                })
                .collect(),
            attendee_count: event.attendees.len(),
            organizer_email: event.organizer_email.clone(),
            conference_url: event.conference_url.clone(),
            macro_call_url: None,
            is_read_only: event.is_read_only,
            calendar_id: event.calendar_id,
            calendar_name: labels.calendar_name(event.calendar_id),
            inbox: labels.inbox(event.calendar_id, None),
            my_role: ToolEventRole::of(event, labels),
        }
    }

    fn from_event_with_macro_call(created: &EventWithMacroCall, labels: &CalendarLabels) -> Self {
        Self {
            macro_call_url: Some(created.meeting_link.url.clone()),
            ..Self::from_event(&created.event, labels)
        }
    }
}

/// Map a domain mutation failure to an agent-readable tool error.
fn mutation_tool_error(action: &str, error: CalendarMutationError) -> ToolCallError {
    let description = match &error {
        CalendarMutationError::NotFound => {
            "The calendar event was not found — it may have been deleted or the id is stale. \
             Use ListCalendarEvents to get current event ids."
                .to_string()
        }
        CalendarMutationError::OccurrenceNotFound => {
            "That occurrence does not exist on the recurring event at the provider — the calendar \
             copy was out of date and has now been refreshed. Nothing was changed. Run \
             ListCalendarEvents again and retry with a current occurrence."
                .to_string()
        }
        CalendarMutationError::ReadOnly => {
            "This event's calendar is read-only for the user, so it cannot be modified.".to_string()
        }
        CalendarMutationError::NoWritableCalendar => {
            "No connected calendar can accept events. The user has not connected a calendar with write access, or calendar sync is not enabled for their account."
                .to_string()
        }
        CalendarMutationError::NotAttendee => {
            "The user's connected account is not an attendee of this event.".to_string()
        }
        CalendarMutationError::NotOrganizer => {
            "Only the event's organizer can change its guest permissions \
             (`viewerCan.setGuestPolicy` from ListCalendarEvents), so leave `guestPolicy` out."
                .to_string()
        }
        CalendarMutationError::GuestsCannotInvite => {
            "Only the organizer can invite guests to this event: the organizer doesn't let \
             guests invite others, or it is an Outlook meeting, where guests cannot add anyone. \
             Suggest asking the organizer to add them."
                .to_string()
        }
        CalendarMutationError::GuestListHidden => {
            "The organizer hides this event's guest list, so the user cannot add guests to it. \
             Suggest asking the organizer to add them."
                .to_string()
        }
        CalendarMutationError::GuestsCannotModify => {
            "The organizer doesn't let guests change this event, so the user can only change \
             their own reminders, add guests where the organizer allows it, and answer the \
             invitation. Suggest asking the organizer to make the change."
                .to_string()
        }
        CalendarMutationError::AlreadyOnCalendar => {
            "The user already has this meeting on one of their calendars, so nothing was \
             added. It cannot be added to another of their calendars either: a copy is refused \
             on every calendar while they hold the meeting. Tell the user it is already on \
             their calendar, and do not offer another calendar."
                .to_string()
        }
        CalendarMutationError::JoinRequestOpen => {
            "The user has asked the person who shared this event to add them as a guest, and \
             that request is pending or already accepted. Either way the event reaches their \
             calendar as the organizer's invitation, and a copy added meanwhile would take that \
             invitation in, so nothing was added. Tell the user they asked to join this event; a \
             copy can be added only if the request is declined."
                .to_string()
        }
        CalendarMutationError::CopyRefused(_) => {
            "Google Calendar refused to add a copy of this event to that calendar. Suggest \
             downloading the event's .ics file instead."
                .to_string()
        }
        CalendarMutationError::Snapshot => {
            "This event is the user's own copy of a meeting shared with them, so an answer or a \
             new guest would never reach the organizer. Suggest asking the organizer instead."
                .to_string()
        }
        CalendarMutationError::InvalidInput(message) => message.clone(),
        CalendarMutationError::ReauthRequired(_) => {
            "Calendar access must be re-authorized. Ask the user to reconnect their calendar in \
             settings."
                .to_string()
        }
        CalendarMutationError::ProviderRejected(message) => {
            format!("The calendar provider rejected the change: {message}")
        }
        CalendarMutationError::Retryable(_) => {
            "The calendar service is temporarily unavailable. Try again shortly.".to_string()
        }
        CalendarMutationError::PersistFailed(_) => {
            "The change reached the calendar provider, but Macro's copy lagged behind. It will appear \
             after the next sync."
                .to_string()
        }
    };
    ToolCallError {
        description: format!("Failed to {action}: {description}"),
        internal_error: error.into(),
    }
}

/// Map a failure creating an event with a Macro call to an agent-readable
/// tool error. Calendar failures read exactly like a plain create; meeting
/// failures say that nothing reached the calendar.
fn macro_call_create_tool_error(error: CreateEventWithMacroCallError) -> ToolCallError {
    match error {
        CreateEventWithMacroCallError::Calendar(error) => {
            mutation_tool_error("create the calendar event", error)
        }
        CreateEventWithMacroCallError::MeetingLink(error) => {
            let description = match &error {
                MeetingLinkError::InvalidInput(message) => {
                    format!("The Macro call could not be created: {message}")
                }
                MeetingLinkError::Unavailable => {
                    "Macro calls cannot be created from here. Retry with `addMacroCall` false, \
                     or use `addConference` for video conferencing."
                        .to_string()
                }
                MeetingLinkError::Failed(_) => {
                    "The Macro call could not be created right now. Nothing was added to the \
                     calendar; try again shortly."
                        .to_string()
                }
            };
            ToolCallError {
                description: format!("Failed to create the calendar event: {description}"),
                internal_error: error.into(),
            }
        }
    }
}
