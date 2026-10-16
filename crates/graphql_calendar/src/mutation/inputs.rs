use async_graphql::{Enum, ID, InputObject, OneofObject};
use calendar_events::domain::{
    models::{
        AttendeeResponseStatus, CalendarAttendeeInput, CalendarEventDraft, CalendarEventPatch,
        ConferenceChange, EventReminderOverride, EventReminders, EventTime, EventTransparency,
        EventVisibility, OutOfOfficeAutoDeclineMode, OutOfOfficeProperties,
    },
    ports::{CalendarDeletionScope, CalendarRsvpScope, CalendarUpdateScope},
};
use graphql_common::parse_id;
use uuid::Uuid;

use crate::{
    bad_input,
    inputs::{parse_date, parse_instant},
    objects::{
        GraphqlCalendarAttendeeResponseStatus, GraphqlCalendarEventTransparency,
        GraphqlCalendarEventVisibility,
    },
};

/// A span with absolute instants.
#[derive(InputObject, Clone, Debug)]
pub struct TimedEventTimeInput {
    /// Inclusive start instant in RFC 3339 format.
    pub starts_at: String,
    /// Exclusive end instant in RFC 3339 format.
    pub ends_at: String,
    /// IANA time-zone identifier the event is anchored to.
    pub time_zone: Option<String>,
}

/// An all-day span with an exclusive end date.
#[derive(InputObject, Clone, Debug)]
pub struct AllDayEventTimeInput {
    /// Inclusive local start date (`YYYY-MM-DD`).
    pub start_date: String,
    /// Exclusive local end date (`YYYY-MM-DD`).
    pub end_date: String,
}

/// The time shape of an event.
#[derive(OneofObject, Clone, Debug)]
pub enum CalendarEventTimeInput {
    /// A span with absolute instants.
    Timed(TimedEventTimeInput),
    /// An all-day span.
    AllDay(AllDayEventTimeInput),
}

impl CalendarEventTimeInput {
    fn into_time(self) -> async_graphql::Result<EventTime> {
        Ok(match self {
            Self::Timed(time) => EventTime::Timed {
                starts_at: parse_instant(&time.starts_at, "time.timed.startsAt")?,
                ends_at: parse_instant(&time.ends_at, "time.timed.endsAt")?,
                time_zone: time.time_zone,
            },
            Self::AllDay(time) => EventTime::AllDay {
                start_date: parse_date(&time.start_date, "time.allDay.startDate")?,
                end_date: parse_date(&time.end_date, "time.allDay.endDate")?,
            },
        })
    }
}

/// An attendee to invite.
#[derive(InputObject, Clone, Debug)]
#[graphql(name = "CalendarAttendeeInput")]
pub struct GraphqlCalendarAttendeeInput {
    /// Attendee email address.
    pub email: String,
    /// Whether attendance is optional.
    #[graphql(default)]
    pub is_optional: bool,
}

impl From<GraphqlCalendarAttendeeInput> for CalendarAttendeeInput {
    fn from(input: GraphqlCalendarAttendeeInput) -> Self {
        Self {
            email: input.email,
            is_optional: input.is_optional,
            response_status: None,
        }
    }
}

/// One reminder.
#[derive(InputObject, Clone, Debug)]
pub struct CalendarReminderOverrideInput {
    /// Delivery method (`popup` or `email`).
    pub method: String,
    /// Minutes before the start the reminder fires.
    pub minutes: i32,
}

/// An event's reminder configuration.
#[derive(InputObject, Clone, Debug)]
pub struct CalendarRemindersInput {
    /// Whether the calendar's default reminders apply.
    pub use_default: bool,
    /// Explicit reminders, used when `useDefault` is false.
    #[graphql(default)]
    pub overrides: Vec<CalendarReminderOverrideInput>,
}

impl CalendarRemindersInput {
    fn into_reminders(self) -> async_graphql::Result<EventReminders> {
        Ok(EventReminders {
            use_default: self.use_default,
            overrides: self
                .overrides
                .into_iter()
                .map(|reminder| {
                    Ok(EventReminderOverride {
                        method: reminder.method,
                        minutes: u32::try_from(reminder.minutes)
                            .map_err(|_| bad_input("reminder minutes must not be negative"))?,
                    })
                })
                .collect::<async_graphql::Result<_>>()?,
        })
    }
}

/// A change to an event's conference.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarConferenceChange {
    /// Generate a new Google Meet conference and attach it.
    GoogleMeet,
    /// Detach whatever conference is currently attached.
    #[graphql(name = "NONE")]
    Detach,
}

impl From<GraphqlCalendarConferenceChange> for ConferenceChange {
    fn from(change: GraphqlCalendarConferenceChange) -> Self {
        match change {
            GraphqlCalendarConferenceChange::GoogleMeet => Self::GoogleMeet,
            GraphqlCalendarConferenceChange::Detach => Self::Removed,
        }
    }
}

/// How an out-of-office event answers conflicting invitations.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarOutOfOfficeAutoDeclineMode {
    /// Leave conflicting invitations alone.
    DeclineNone,
    /// Decline every conflicting invitation, existing and new.
    DeclineAllConflictingInvitations,
    /// Decline only invitations that arrive after the event is created.
    DeclineOnlyNewConflictingInvitations,
}

impl From<GraphqlCalendarOutOfOfficeAutoDeclineMode> for OutOfOfficeAutoDeclineMode {
    fn from(mode: GraphqlCalendarOutOfOfficeAutoDeclineMode) -> Self {
        match mode {
            GraphqlCalendarOutOfOfficeAutoDeclineMode::DeclineNone => Self::DeclineNone,
            GraphqlCalendarOutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations => {
                Self::DeclineAllConflictingInvitations
            }
            GraphqlCalendarOutOfOfficeAutoDeclineMode::DeclineOnlyNewConflictingInvitations => {
                Self::DeclineOnlyNewConflictingInvitations
            }
        }
    }
}

/// Out-of-office properties. Present to create or edit an out-of-office
/// status event.
#[derive(InputObject, Clone, Debug)]
pub struct CalendarOutOfOfficeInput {
    /// How conflicting invitations are handled while the user is out.
    #[graphql(default_with = "GraphqlCalendarOutOfOfficeAutoDeclineMode::DeclineNone")]
    pub auto_decline_mode: GraphqlCalendarOutOfOfficeAutoDeclineMode,
    /// Message returned to organizers whose invitations are auto-declined.
    pub decline_message: Option<String>,
}

impl From<CalendarOutOfOfficeInput> for OutOfOfficeProperties {
    fn from(input: CalendarOutOfOfficeInput) -> Self {
        Self {
            auto_decline_mode: input.auto_decline_mode.into(),
            decline_message: input.decline_message,
        }
    }
}

impl From<GraphqlCalendarEventVisibility> for EventVisibility {
    fn from(visibility: GraphqlCalendarEventVisibility) -> Self {
        match visibility {
            GraphqlCalendarEventVisibility::Default => Self::Default,
            GraphqlCalendarEventVisibility::Public => Self::Public,
            GraphqlCalendarEventVisibility::Private => Self::Private,
            GraphqlCalendarEventVisibility::Confidential => Self::Confidential,
        }
    }
}

impl From<GraphqlCalendarEventTransparency> for EventTransparency {
    fn from(transparency: GraphqlCalendarEventTransparency) -> Self {
        match transparency {
            GraphqlCalendarEventTransparency::Opaque => Self::Opaque,
            GraphqlCalendarEventTransparency::Transparent => Self::Transparent,
        }
    }
}

impl From<GraphqlCalendarAttendeeResponseStatus> for AttendeeResponseStatus {
    fn from(status: GraphqlCalendarAttendeeResponseStatus) -> Self {
        match status {
            GraphqlCalendarAttendeeResponseStatus::NeedsAction => Self::NeedsAction,
            GraphqlCalendarAttendeeResponseStatus::Accepted => Self::Accepted,
            GraphqlCalendarAttendeeResponseStatus::Declined => Self::Declined,
            GraphqlCalendarAttendeeResponseStatus::Tentative => Self::Tentative,
        }
    }
}

/// Create an event on one of the viewer's writable calendars.
#[derive(InputObject, Clone, Debug)]
pub struct CreateCalendarEventInput {
    /// Stable retry identity, scoped to the authenticated organizer.
    pub idempotency_key: Option<ID>,
    /// Exact calendar to create the event on; takes precedence over the
    /// inbox default.
    pub calendar_id: Option<ID>,
    /// Connected inbox whose primary calendar receives the event; defaults
    /// to the viewer's primary inbox.
    pub email_link_id: Option<ID>,
    /// Display title.
    pub title: String,
    /// Optional event body.
    pub description: Option<String>,
    /// Optional location label.
    pub location: Option<String>,
    /// Timed or all-day shape.
    pub time: CalendarEventTimeInput,
    /// Invited attendees.
    #[graphql(default)]
    pub attendees: Vec<GraphqlCalendarAttendeeInput>,
    /// Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`).
    #[graphql(default)]
    pub recurrence_lines: Vec<String>,
    /// Event visibility.
    pub visibility: Option<GraphqlCalendarEventVisibility>,
    /// Availability behavior.
    pub transparency: Option<GraphqlCalendarEventTransparency>,
    /// Reminder configuration; omit to keep the calendar defaults.
    pub reminders: Option<CalendarRemindersInput>,
    /// Conference to attach; omit to create the event without one.
    pub conference: Option<GraphqlCalendarConferenceChange>,
    /// Present to create an out-of-office status event (primary calendar
    /// only, timed, no attendees).
    pub out_of_office: Option<CalendarOutOfOfficeInput>,
}

pub(crate) struct CreateRequest {
    pub(crate) email_link_id: Option<Uuid>,
    pub(crate) calendar_id: Option<Uuid>,
    pub(crate) draft: CalendarEventDraft,
}

impl CreateCalendarEventInput {
    pub(crate) fn into_request(self) -> async_graphql::Result<CreateRequest> {
        Ok(CreateRequest {
            email_link_id: optional_id(self.email_link_id, "emailLinkId")?,
            calendar_id: optional_id(self.calendar_id, "calendarId")?,
            draft: CalendarEventDraft {
                idempotency_key: optional_id(self.idempotency_key, "idempotencyKey")?,
                title: self.title,
                description: self.description,
                location: self.location,
                time: self.time.into_time()?,
                attendees: self.attendees.into_iter().map(Into::into).collect(),
                recurrence_lines: self.recurrence_lines,
                visibility: self.visibility.map(Into::into),
                transparency: self.transparency.map(Into::into),
                reminders: self
                    .reminders
                    .map(CalendarRemindersInput::into_reminders)
                    .transpose()?,
                conference: self.conference.map(Into::into),
                out_of_office: self.out_of_office.map(Into::into),
            },
        })
    }
}

/// How much of a recurring series an update applies to.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarUpdateScope {
    /// The entire event or series.
    All,
    /// One occurrence.
    ThisEvent,
}

/// Patch an event; omitted fields are left untouched.
#[derive(InputObject, Clone, Debug)]
pub struct UpdateCalendarEventInput {
    /// Event to patch.
    pub event_id: ID,
    /// Calendar whose copy of the event is patched, for an event synced from
    /// more than one calendar. Omit to patch the canonical copy.
    pub calendar_id: Option<ID>,
    /// Replacement title; an empty string clears it.
    pub title: Option<String>,
    /// Replacement description; an empty string clears it.
    pub description: Option<String>,
    /// Replacement location; an empty string clears it.
    pub location: Option<String>,
    /// Replacement time.
    pub time: Option<CalendarEventTimeInput>,
    /// Replacement attendee list.
    pub attendees: Option<Vec<GraphqlCalendarAttendeeInput>>,
    /// Replacement recurrence properties; an empty list clears them.
    pub recurrence_lines: Option<Vec<String>>,
    /// Replacement visibility.
    pub visibility: Option<GraphqlCalendarEventVisibility>,
    /// Replacement transparency.
    pub transparency: Option<GraphqlCalendarEventTransparency>,
    /// Replacement reminder configuration.
    pub reminders: Option<CalendarRemindersInput>,
    /// Conference change; omit to leave the conference untouched.
    pub conference: Option<GraphqlCalendarConferenceChange>,
    /// Replacement out-of-office properties, applied only to an event that is
    /// already out-of-office.
    pub out_of_office: Option<CalendarOutOfOfficeInput>,
    /// How much of a recurring series the update covers. Omit to let
    /// `recurrenceId` decide: the identified occurrence alone when one is
    /// supplied, otherwise the whole event or series.
    pub scope: Option<GraphqlCalendarUpdateScope>,
    /// Original-start key of the occurrence the update targets.
    pub recurrence_id: Option<String>,
}

pub(crate) struct UpdateRequest {
    pub(crate) event_id: Uuid,
    pub(crate) calendar_id: Option<Uuid>,
    pub(crate) patch: CalendarEventPatch,
    pub(crate) scope: CalendarUpdateScope,
}

impl UpdateCalendarEventInput {
    pub(crate) fn into_request(self) -> async_graphql::Result<UpdateRequest> {
        let scope = match (self.scope, self.recurrence_id) {
            (Some(GraphqlCalendarUpdateScope::All), None) | (None, None) => {
                CalendarUpdateScope::All
            }
            (Some(GraphqlCalendarUpdateScope::ThisEvent), Some(recurrence_id))
            | (None, Some(recurrence_id)) => CalendarUpdateScope::ThisEvent { recurrence_id },
            (Some(GraphqlCalendarUpdateScope::ThisEvent), None) => {
                return Err(bad_input("a this-event update requires recurrenceId"));
            }
            (Some(GraphqlCalendarUpdateScope::All), Some(_)) => {
                return Err(bad_input(
                    "recurrenceId only applies to a this_event update",
                ));
            }
        };
        Ok(UpdateRequest {
            event_id: parse_id(self.event_id, "eventId")?,
            calendar_id: optional_id(self.calendar_id, "calendarId")?,
            patch: CalendarEventPatch {
                title: self.title,
                description: self.description,
                location: self.location,
                time: self
                    .time
                    .map(CalendarEventTimeInput::into_time)
                    .transpose()?,
                attendees: self
                    .attendees
                    .map(|attendees| attendees.into_iter().map(Into::into).collect()),
                recurrence_lines: self.recurrence_lines,
                visibility: self.visibility.map(Into::into),
                transparency: self.transparency.map(Into::into),
                reminders: self
                    .reminders
                    .map(CalendarRemindersInput::into_reminders)
                    .transpose()?,
                conference: self.conference.map(Into::into),
                out_of_office: self.out_of_office.map(Into::into),
            },
            scope,
        })
    }
}

/// How much of a recurring series a deletion removes.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarDeletionScope {
    /// The entire event or series.
    All,
    /// One occurrence.
    ThisEvent,
    /// One occurrence and everything after it.
    ThisAndFollowing,
}

/// Delete an event, one occurrence, or an occurrence onward.
#[derive(InputObject, Clone, Debug)]
pub struct DeleteCalendarEventInput {
    /// Event to delete.
    pub event_id: ID,
    /// Calendar whose copy of the event is deleted, for an event synced from
    /// more than one calendar. Omit to delete the canonical copy.
    pub calendar_id: Option<ID>,
    /// Deletion scope; defaults to the entire event or series.
    #[graphql(default_with = "GraphqlCalendarDeletionScope::All")]
    pub scope: GraphqlCalendarDeletionScope,
    /// Original-start key of the occurrence a scoped deletion targets.
    pub recurrence_id: Option<String>,
}

pub(crate) struct DeleteRequest {
    pub(crate) event_id: Uuid,
    pub(crate) calendar_id: Option<Uuid>,
    pub(crate) scope: CalendarDeletionScope,
}

impl DeleteCalendarEventInput {
    pub(crate) fn into_request(self) -> async_graphql::Result<DeleteRequest> {
        let scoped_occurrence = |kind: &str| {
            self.recurrence_id
                .clone()
                .ok_or_else(|| bad_input(format!("a {kind} deletion requires recurrenceId")))
        };
        let scope = match self.scope {
            GraphqlCalendarDeletionScope::All => CalendarDeletionScope::All,
            GraphqlCalendarDeletionScope::ThisEvent => CalendarDeletionScope::ThisEvent {
                recurrence_id: scoped_occurrence("this-event")?,
            },
            GraphqlCalendarDeletionScope::ThisAndFollowing => {
                CalendarDeletionScope::ThisAndFollowing {
                    recurrence_id: scoped_occurrence("this-and-following")?,
                }
            }
        };
        Ok(DeleteRequest {
            event_id: parse_id(self.event_id, "eventId")?,
            calendar_id: optional_id(self.calendar_id, "calendarId")?,
            scope,
        })
    }
}

/// How much of a recurring series an RSVP applies to.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarRsvpScope {
    /// The entire series.
    All,
    /// One occurrence.
    ThisEvent,
}

/// Set the viewer's RSVP on an event.
#[derive(InputObject, Clone, Debug)]
pub struct RespondToCalendarEventInput {
    /// Event to answer.
    pub event_id: ID,
    /// Calendar whose copy of the event is answered, for an event synced
    /// from more than one calendar. Omit to answer on the canonical copy.
    pub calendar_id: Option<ID>,
    /// The response to record.
    pub response: GraphqlCalendarAttendeeResponseStatus,
    /// How much of a recurring series the response covers. Omit to let
    /// `recurrenceId` decide: the identified occurrence alone when one is
    /// supplied, otherwise the whole series.
    pub scope: Option<GraphqlCalendarRsvpScope>,
    /// Original-start key of the occurrence the response targets.
    pub recurrence_id: Option<String>,
    /// The owned connected address whose attendance is changed.
    pub responding_email: Option<String>,
}

pub(crate) struct RsvpRequest {
    pub(crate) event_id: Uuid,
    pub(crate) calendar_id: Option<Uuid>,
    pub(crate) response: AttendeeResponseStatus,
    pub(crate) scope: CalendarRsvpScope,
    pub(crate) responding_email: Option<String>,
}

impl RespondToCalendarEventInput {
    pub(crate) fn into_request(self) -> async_graphql::Result<RsvpRequest> {
        let scope = match (self.scope, self.recurrence_id) {
            (Some(GraphqlCalendarRsvpScope::All), _) | (None, None) => CalendarRsvpScope::All,
            (Some(GraphqlCalendarRsvpScope::ThisEvent), Some(recurrence_id))
            | (None, Some(recurrence_id)) => CalendarRsvpScope::ThisEvent { recurrence_id },
            (Some(GraphqlCalendarRsvpScope::ThisEvent), None) => {
                return Err(bad_input("a this-event response requires recurrenceId"));
            }
        };
        Ok(RsvpRequest {
            event_id: parse_id(self.event_id, "eventId")?,
            calendar_id: optional_id(self.calendar_id, "calendarId")?,
            response: self.response.into(),
            scope,
            responding_email: self.responding_email,
        })
    }
}

fn optional_id(id: Option<ID>, field: &str) -> async_graphql::Result<Option<Uuid>> {
    id.map(|id| parse_id(id, field)).transpose()
}
