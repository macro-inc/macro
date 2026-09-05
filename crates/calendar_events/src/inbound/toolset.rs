//! AI toolset adapter for calendar events.
//!
//! Tools are thin: they convert tool inputs into domain calls on the
//! [`CalendarMutationService`] and [`CalendarOccurrenceService`] ports and
//! map domain errors to agent-readable failures. Authorization and business
//! policy live behind those ports, exactly as for the HTTP routers.

mod create_calendar_event;
mod delete_calendar_event;
mod list_calendar_events;
mod list_calendars;
mod update_calendar_event;

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, ToolCallError};
use chrono::NaiveDate;
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::{
    models::{
        CalendarAttendeeInput, CalendarEvent, EventReminderOverride, EventReminders, EventTime,
        OutOfOfficeAutoDeclineMode, OutOfOfficeProperties,
    },
    ports::{CalendarMutationError, CalendarMutationService, CalendarOccurrenceService},
};

pub use create_calendar_event::CreateCalendarEvent;
pub use delete_calendar_event::{
    DeleteCalendarEvent, DeleteCalendarEventResponse, DeletionScopeInput,
};
pub use list_calendar_events::{
    CalendarEventListItem, ListCalendarEvents, ListCalendarEventsResponse,
};
pub use list_calendars::{ListCalendars, ListCalendarsToolResponse, ToolCalendar};
pub use update_calendar_event::{
    ConferenceChangeInput, RsvpResponseInput, UpdateCalendarEvent, UpdateScopeInput,
};

/// Service context for calendar AI tools.
pub struct CalendarToolContext<M, O>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    /// Write path: user-initiated mutations, written through to the provider.
    pub mutations: Arc<M>,
    /// Read path: bounded occurrence viewport queries.
    pub occurrences: Arc<O>,
}

impl<M, O> Clone for CalendarToolContext<M, O>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    fn clone(&self) -> Self {
        Self {
            mutations: Arc::clone(&self.mutations),
            occurrences: Arc::clone(&self.occurrences),
        }
    }
}

impl<M, O> CalendarToolContext<M, O>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    /// Create a calendar tool context from its two ports.
    pub fn new(mutations: Arc<M>, occurrences: Arc<O>) -> Self {
        Self {
            mutations,
            occurrences,
        }
    }
}

fn shared_calendar_toolset<M, O>() -> AsyncToolCollection<CalendarToolContext<M, O>>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    AsyncToolCollection::new()
        .add_tool::<ListCalendarEvents, CalendarToolContext<M, O>>()
        .add_tool::<ListCalendars, CalendarToolContext<M, O>>()
        .add_tool::<UpdateCalendarEvent, CalendarToolContext<M, O>>()
        .add_tool::<DeleteCalendarEvent, CalendarToolContext<M, O>>()
}

/// Create the AI chat calendar toolset.
///
/// Event creation is deferred until the user reviews and executes the pending
/// call. Reads, updates, and deletions continue to execute in the agent loop.
pub fn calendar_toolset<M, O>() -> AsyncToolCollection<CalendarToolContext<M, O>>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    shared_calendar_toolset().add_user_tool::<CreateCalendarEvent, CalendarToolContext<M, O>>()
}

/// Create the calendar toolset for hosts without a composer — the MCP server
/// and the channel-mention bot.
///
/// These hosts receive the real create tool and apply their own confirmation
/// policy from its annotations rather than the chat-specific deferred flow,
/// which only the chat frontend can finish.
pub fn mcp_toolset<M, O>() -> AsyncToolCollection<CalendarToolContext<M, O>>
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    shared_calendar_toolset().add_tool::<CreateCalendarEvent, CalendarToolContext<M, O>>()
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
    /// Whether the user's calendar prohibits modifying this event.
    pub is_read_only: bool,
    /// Calendar the event belongs to, when known.
    pub calendar_id: Option<uuid::Uuid>,
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
    fn from_event(event: &CalendarEvent) -> Self {
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
            is_read_only: event.is_read_only,
            calendar_id: event.calendar_id,
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
            "That occurrence does not exist on the recurring event at Google — the calendar \
             copy was out of date and has now been refreshed. Nothing was changed. Run \
             ListCalendarEvents again and retry with a current occurrence."
                .to_string()
        }
        CalendarMutationError::ReadOnly => {
            "This event's calendar is read-only for the user, so it cannot be modified.".to_string()
        }
        CalendarMutationError::NoWritableCalendar => {
            "No connected calendar can accept events. The user has not connected a Google \
             Calendar with write access, or calendar sync is not enabled for their account."
                .to_string()
        }
        CalendarMutationError::NotAttendee => {
            "The user's connected account is not an attendee of this event.".to_string()
        }
        CalendarMutationError::InvalidInput(message) => message.clone(),
        CalendarMutationError::ReauthRequired(_) => {
            "Calendar access must be re-authorized. Ask the user to reconnect their calendar in \
             settings."
                .to_string()
        }
        CalendarMutationError::ProviderRejected(message) => {
            format!("Google Calendar rejected the change: {message}")
        }
        CalendarMutationError::Retryable(_) => {
            "The calendar service is temporarily unavailable. Try again shortly.".to_string()
        }
        CalendarMutationError::PersistFailed(_) => {
            "The change reached Google Calendar, but Macro's copy lagged behind. It will appear \
             after the next sync."
                .to_string()
        }
    };
    ToolCallError {
        description: format!("Failed to {action}: {description}"),
        internal_error: error.into(),
    }
}
