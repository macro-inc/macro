use async_graphql::{Enum, ID, SimpleObject, Union};
use calendar_events::domain::models::{
    AttendeeResponseStatus, CalendarAttendee, CalendarEvent, CalendarEventSourceContent,
    CalendarOccurrence, CalendarSyncStatus, ConferenceProvider, EventReminderOverride,
    EventReminders, EventStatus, EventTime, EventTransparency, EventType, EventVisibility,
    OccurrenceListing, VisibleCalendar,
};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Event status.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarEventStatus {
    /// The event is confirmed.
    Confirmed,
    /// The event is tentatively confirmed.
    Tentative,
    /// The event was cancelled.
    Cancelled,
}

impl From<EventStatus> for GraphqlCalendarEventStatus {
    fn from(status: EventStatus) -> Self {
        match status {
            EventStatus::Confirmed => Self::Confirmed,
            EventStatus::Tentative => Self::Tentative,
            EventStatus::Cancelled => Self::Cancelled,
        }
    }
}

/// Event visibility.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarEventVisibility {
    /// The calendar's default visibility.
    Default,
    /// Visible to everyone with access to the calendar.
    Public,
    /// Details visible only to attendees.
    Private,
    /// Treated as private.
    Confidential,
}

impl From<EventVisibility> for GraphqlCalendarEventVisibility {
    fn from(visibility: EventVisibility) -> Self {
        match visibility {
            EventVisibility::Default => Self::Default,
            EventVisibility::Public => Self::Public,
            EventVisibility::Private => Self::Private,
            EventVisibility::Confidential => Self::Confidential,
        }
    }
}

/// Whether the event blocks time on the calendar.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarEventTransparency {
    /// The event blocks time.
    Opaque,
    /// The event does not block time.
    Transparent,
}

impl From<EventTransparency> for GraphqlCalendarEventTransparency {
    fn from(transparency: EventTransparency) -> Self {
        match transparency {
            EventTransparency::Opaque => Self::Opaque,
            EventTransparency::Transparent => Self::Transparent,
        }
    }
}

/// Provider event type.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarEventType {
    /// A regular event.
    Default,
    /// An out-of-office block.
    OutOfOffice,
    /// A focus-time block.
    FocusTime,
    /// A working-location marker.
    WorkingLocation,
    /// A contact's birthday.
    Birthday,
    /// An event Gmail created from an email.
    FromGmail,
}

impl From<EventType> for GraphqlCalendarEventType {
    fn from(event_type: EventType) -> Self {
        match event_type {
            EventType::Default => Self::Default,
            EventType::OutOfOffice => Self::OutOfOffice,
            EventType::FocusTime => Self::FocusTime,
            EventType::WorkingLocation => Self::WorkingLocation,
            EventType::Birthday => Self::Birthday,
            EventType::FromGmail => Self::FromGmail,
        }
    }
}

/// Conferencing system backing an event's join URL.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarConferenceProvider {
    /// Google Meet.
    GoogleMeet,
    /// Any other conferencing system.
    Other,
}

impl From<ConferenceProvider> for GraphqlCalendarConferenceProvider {
    fn from(provider: ConferenceProvider) -> Self {
        match provider {
            ConferenceProvider::GoogleMeet => Self::GoogleMeet,
            ConferenceProvider::Other => Self::Other,
        }
    }
}

/// An attendee's RSVP.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarAttendeeResponseStatus {
    /// The attendee has not responded.
    NeedsAction,
    /// The attendee accepted.
    Accepted,
    /// The attendee declined.
    Declined,
    /// The attendee tentatively accepted.
    Tentative,
}

impl From<AttendeeResponseStatus> for GraphqlCalendarAttendeeResponseStatus {
    fn from(status: AttendeeResponseStatus) -> Self {
        match status {
            AttendeeResponseStatus::NeedsAction => Self::NeedsAction,
            AttendeeResponseStatus::Accepted => Self::Accepted,
            AttendeeResponseStatus::Declined => Self::Declined,
            AttendeeResponseStatus::Tentative => Self::Tentative,
        }
    }
}

/// Aggregate ingestion state across every calendar account visible to the
/// viewer.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlCalendarSyncStatus {
    /// At least one visible calendar account is still ingesting.
    Syncing,
    /// Every visible calendar account has finished its latest sync.
    Ready,
}

impl From<CalendarSyncStatus> for GraphqlCalendarSyncStatus {
    fn from(status: CalendarSyncStatus) -> Self {
        match status {
            CalendarSyncStatus::Syncing => Self::Syncing,
            CalendarSyncStatus::Ready => Self::Ready,
        }
    }
}

/// A span with absolute instants.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlTimedEventTime {
    /// Inclusive start instant in RFC 3339 format.
    starts_at: String,
    /// Exclusive end instant in RFC 3339 format.
    ends_at: String,
    /// Original IANA time-zone identifier, when supplied.
    time_zone: Option<String>,
}

/// An all-day span using RFC 5545's exclusive end date.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlAllDayEventTime {
    /// Inclusive local start date (`YYYY-MM-DD`).
    start_date: String,
    /// Exclusive local end date (`YYYY-MM-DD`).
    end_date: String,
}

/// The mutually exclusive time shape of an event or occurrence.
#[derive(Union, Clone, Debug, PartialEq, Eq)]
pub enum GraphqlEventTime {
    /// A span with absolute instants.
    Timed(GraphqlTimedEventTime),
    /// An all-day span.
    AllDay(GraphqlAllDayEventTime),
}

impl From<EventTime> for GraphqlEventTime {
    fn from(time: EventTime) -> Self {
        match time {
            EventTime::Timed {
                starts_at,
                ends_at,
                time_zone,
            } => Self::Timed(GraphqlTimedEventTime {
                starts_at: starts_at.to_rfc3339(),
                ends_at: ends_at.to_rfc3339(),
                time_zone,
            }),
            EventTime::AllDay {
                start_date,
                end_date,
            } => Self::AllDay(GraphqlAllDayEventTime {
                start_date: start_date.to_string(),
                end_date: end_date.to_string(),
            }),
        }
    }
}

/// One event attendee.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlCalendarAttendee {
    /// Attendee email address.
    email: String,
    /// Attendee display name.
    display_name: Option<String>,
    /// The attendee's RSVP.
    response_status: GraphqlCalendarAttendeeResponseStatus,
    /// Whether the attendee organizes the event.
    is_organizer: bool,
    /// Whether the attendee is optional.
    is_optional: bool,
    /// Whether the attendee is one of the viewer's own connected inboxes.
    is_self: bool,
    /// The attendee's RSVP comment.
    comment: Option<String>,
}

impl From<CalendarAttendee> for GraphqlCalendarAttendee {
    fn from(attendee: CalendarAttendee) -> Self {
        Self {
            email: attendee.email,
            display_name: attendee.display_name,
            response_status: attendee.response_status.into(),
            is_organizer: attendee.is_organizer,
            is_optional: attendee.is_optional,
            is_self: attendee.is_self,
            comment: attendee.comment,
        }
    }
}

/// One reminder override.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlCalendarReminderOverride {
    /// Delivery method (`popup` or `email`).
    method: String,
    /// Minutes before the start the reminder fires.
    minutes: i32,
}

impl From<EventReminderOverride> for GraphqlCalendarReminderOverride {
    fn from(reminder: EventReminderOverride) -> Self {
        Self {
            method: reminder.method,
            minutes: i32::try_from(reminder.minutes).unwrap_or(i32::MAX),
        }
    }
}

/// An event's reminder configuration.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlCalendarReminders {
    /// Whether the calendar's default reminders apply.
    use_default: bool,
    /// Explicit reminders, used when `useDefault` is false.
    overrides: Vec<GraphqlCalendarReminderOverride>,
}

impl From<EventReminders> for GraphqlCalendarReminders {
    fn from(reminders: EventReminders) -> Self {
        Self {
            use_default: reminders.use_default,
            overrides: reminders.overrides.into_iter().map(Into::into).collect(),
        }
    }
}

/// Content of one calendar's copy of an event.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlCalendarEventSource {
    /// Calendar this copy lives on.
    calendar_id: ID,
    /// Display title.
    title: String,
    /// Optional event body.
    description: Option<String>,
    /// Optional physical or virtual location label.
    location: Option<String>,
    /// Provider event type.
    event_type: GraphqlCalendarEventType,
    /// Event visibility.
    visibility: GraphqlCalendarEventVisibility,
    /// Availability behavior.
    transparency: GraphqlCalendarEventTransparency,
    /// Whether the calendar's access role prohibits editing this copy.
    is_read_only: bool,
    /// Reminder configuration of this copy.
    reminders: GraphqlCalendarReminders,
    /// Provider-reported creator email.
    creator_email: Option<String>,
    /// Provider-reported creator display name.
    creator_name: Option<String>,
}

impl From<CalendarEventSourceContent> for GraphqlCalendarEventSource {
    fn from(source: CalendarEventSourceContent) -> Self {
        Self {
            calendar_id: id(source.calendar_id),
            title: source.title,
            description: source.description,
            location: source.location,
            event_type: source.event_type.into(),
            visibility: source.visibility.into(),
            transparency: source.transparency.into(),
            is_read_only: source.is_read_only,
            reminders: source.reminders.into(),
            creator_email: source.creator_email,
            creator_name: source.creator_name,
        }
    }
}

/// A calendar event entity: the series content shared by every occurrence.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlCalendarEvent {
    /// Macro event identifier.
    id: ID,
    /// Macro user who owns this event projection.
    owner_id: String,
    /// Connected inbox whose grant backs the event.
    link_id: ID,
    /// RFC 5545 UID used to reconcile provider and email sources.
    ical_uid: String,
    /// Calendar the canonical source belongs to, when known.
    calendar_id: Option<ID>,
    /// Content of every active copy of this event, canonical first.
    sources: Vec<GraphqlCalendarEventSource>,
    /// Display title.
    title: String,
    /// Optional event body.
    description: Option<String>,
    /// Optional physical or virtual location label.
    location: Option<String>,
    /// Event status.
    status: GraphqlCalendarEventStatus,
    /// Event visibility.
    visibility: GraphqlCalendarEventVisibility,
    /// Availability behavior.
    transparency: GraphqlCalendarEventTransparency,
    /// Provider event type.
    event_type: GraphqlCalendarEventType,
    /// The series time span.
    time: GraphqlEventTime,
    /// Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`).
    recurrence_lines: Vec<String>,
    /// Organizer email.
    organizer_email: Option<String>,
    /// Organizer display name.
    organizer_name: Option<String>,
    /// Provider-reported creator email.
    creator_email: Option<String>,
    /// Provider-reported creator display name.
    creator_name: Option<String>,
    /// Direct join URL when known.
    conference_url: Option<String>,
    /// Which conferencing system backs `conferenceUrl`.
    conference_provider: Option<GraphqlCalendarConferenceProvider>,
    /// Provider/iCalendar sequence number.
    sequence: i32,
    /// Whether the canonical source's calendar prohibits editing it.
    is_read_only: bool,
    /// Series attendees.
    attendees: Vec<GraphqlCalendarAttendee>,
    /// Reminder configuration.
    reminders: GraphqlCalendarReminders,
    /// Entity creation time in RFC 3339 format.
    created_at: String,
    /// Entity update time in RFC 3339 format.
    updated_at: String,
}

impl GraphqlCalendarEvent {
    /// Map a series event synced through `link_id`.
    pub fn new(event: CalendarEvent, link_id: Uuid) -> Self {
        Self {
            id: id(event.id),
            owner_id: event.owner_id,
            link_id: id(link_id),
            ical_uid: event.ical_uid,
            calendar_id: event.calendar_id.map(id),
            sources: event.sources.into_iter().map(Into::into).collect(),
            title: event.title,
            description: event.description,
            location: event.location,
            status: event.status.into(),
            visibility: event.visibility.into(),
            transparency: event.transparency.into(),
            event_type: event.event_type.into(),
            time: event.time.into(),
            recurrence_lines: event.recurrence_lines,
            organizer_email: event.organizer_email,
            organizer_name: event.organizer_name,
            creator_email: event.creator_email,
            creator_name: event.creator_name,
            conference_url: event.conference_url,
            conference_provider: event.conference_provider.map(Into::into),
            sequence: i32::try_from(event.sequence).unwrap_or(i32::MAX),
            is_read_only: event.is_read_only,
            attendees: event.attendees.into_iter().map(Into::into).collect(),
            reminders: event.reminders.into(),
            created_at: event.created_at.to_rfc3339(),
            updated_at: event.updated_at.to_rfc3339(),
        }
    }
}

/// One materialized instance of a calendar event.
///
/// `eventId` and `linkId` repeat the event's identity as scalars so a client
/// range index can project occurrences without dereferencing the event.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlCalendarOccurrence {
    /// `{eventId}:{occurrenceKey}`.
    id: ID,
    /// Owning event identifier.
    event_id: ID,
    /// Connected inbox whose grant backs the event.
    link_id: ID,
    /// The series event.
    event: GraphqlCalendarEvent,
    /// Stable key within the event.
    occurrence_key: String,
    /// Provider recurrence identifier, when applicable.
    recurrence_id: Option<String>,
    /// Instance time.
    time: GraphqlEventTime,
    /// Whether the instance was cancelled.
    is_cancelled: bool,
    /// Title replacing the series title on this instance alone.
    override_title: Option<String>,
    /// Description replacing the series description on this instance alone.
    override_description: Option<String>,
    /// Location replacing the series location on this instance alone.
    override_location: Option<String>,
    /// Status replacing the series status on this instance alone.
    override_status: Option<GraphqlCalendarEventStatus>,
    /// Attendee list replacing the series list on this instance alone, where
    /// an instance-scoped RSVP is recorded.
    override_attendees: Option<Vec<GraphqlCalendarAttendee>>,
}

impl From<OccurrenceListing> for GraphqlCalendarOccurrence {
    fn from(listing: OccurrenceListing) -> Self {
        let OccurrenceListing {
            event,
            occurrence,
            link_id,
            exception,
        } = listing;
        let CalendarOccurrence {
            event_id,
            occurrence_key,
            recurrence_id,
            time,
            is_cancelled,
        } = occurrence;
        Self {
            id: occurrence_id(event_id, &occurrence_key),
            event_id: id(event_id),
            link_id: id(link_id),
            event: GraphqlCalendarEvent::new(event, link_id),
            occurrence_key,
            recurrence_id,
            time: time.into(),
            is_cancelled,
            override_title: exception.title,
            override_description: exception.description,
            override_location: exception.location,
            override_status: exception.status.map(Into::into),
            override_attendees: exception
                .attendees
                .map(|attendees| attendees.into_iter().map(Into::into).collect()),
        }
    }
}

/// A calendar visible to the viewer.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlCalendar {
    /// Macro calendar identifier.
    id: ID,
    /// Connected inbox that syncs this calendar.
    link_id: ID,
    /// Connected inbox address.
    email_address: String,
    /// Provider display name.
    name: String,
    /// Provider color.
    color: Option<String>,
    /// Whether this is its account's primary calendar.
    is_primary: bool,
    /// Whether the grant can create and modify events on this calendar.
    is_writable: bool,
    /// Whether this is a shared system calendar (holidays, birthdays).
    is_subscription: bool,
    /// A persistent sync failure isolated to this calendar.
    sync_error: Option<String>,
    /// Default reminders applied to events that keep `useDefault`.
    default_reminders: Vec<GraphqlCalendarReminderOverride>,
}

impl From<VisibleCalendar> for GraphqlCalendar {
    fn from(calendar: VisibleCalendar) -> Self {
        Self {
            id: id(calendar.id),
            link_id: id(calendar.email_link_id),
            email_address: calendar.email_address,
            name: calendar.name,
            color: calendar.color,
            is_primary: calendar.is_primary,
            is_writable: calendar.is_writable,
            is_subscription: calendar.is_subscription,
            sync_error: calendar.sync_error,
            default_reminders: calendar
                .default_reminders
                .into_iter()
                .map(Into::into)
                .collect(),
        }
    }
}

/// How far the viewer's client has read one connected inbox's calendar
/// change log.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlCalendarLinkWatermark {
    /// Connected inbox identifier.
    pub(crate) link_id: ID,
    /// Last change-log sequence covered, as a decimal string.
    pub(crate) seq: String,
}

/// One page of occurrences overlapping a viewport.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct GraphqlCalendarOccurrencePage {
    /// Occurrences ordered by start, event, and occurrence key.
    pub(crate) nodes: Vec<GraphqlCalendarOccurrence>,
    /// Whether another page follows.
    pub(crate) has_next_page: bool,
    /// Cursor for the next page, present when `hasNextPage` is true.
    pub(crate) end_cursor: Option<String>,
    /// Aggregate ingestion state; clients render a skeleton while syncing.
    pub(crate) sync_status: GraphqlCalendarSyncStatus,
    /// Change-log position of every visible connected inbox, captured before
    /// the page was read.
    pub(crate) watermark: Vec<GraphqlCalendarLinkWatermark>,
}

/// The cache identity of one occurrence.
pub(crate) fn occurrence_id(event_id: Uuid, occurrence_key: &str) -> ID {
    ID(format!("{event_id}:{occurrence_key}"))
}

fn id(value: Uuid) -> ID {
    ID(value.to_string())
}
