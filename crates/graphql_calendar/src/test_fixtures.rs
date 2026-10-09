use calendar_events::domain::models::{
    AttendeeResponseStatus, CalendarAttendee, CalendarEvent, CalendarOccurrence, EventReminders,
    EventStatus, EventTime, EventTransparency, EventType, EventVisibility, OccurrenceException,
    OccurrenceListing,
};
use chrono::{TimeZone, Utc};
use uuid::Uuid;

pub(crate) const EVENT_ID: Uuid = Uuid::from_u128(0x11);
pub(crate) const LINK_ID: Uuid = Uuid::from_u128(0x22);
pub(crate) const CALENDAR_ID: Uuid = Uuid::from_u128(0x33);

pub(crate) fn attendee(email: &str, status: AttendeeResponseStatus) -> CalendarAttendee {
    CalendarAttendee {
        email: email.to_owned(),
        display_name: None,
        response_status: status,
        is_organizer: false,
        is_optional: false,
        is_self: false,
        comment: None,
    }
}

pub(crate) fn series_event() -> CalendarEvent {
    let starts_at = Utc.with_ymd_and_hms(2026, 10, 6, 15, 0, 0).unwrap();
    CalendarEvent {
        id: EVENT_ID,
        owner_id: "macro|owner@example.com".to_owned(),
        ical_uid: "uid@example.com".to_owned(),
        calendar_id: Some(CALENDAR_ID),
        sources: Vec::new(),
        title: "Standup".to_owned(),
        description: None,
        location: None,
        status: EventStatus::Confirmed,
        visibility: EventVisibility::Default,
        transparency: EventTransparency::Opaque,
        event_type: EventType::Default,
        time: EventTime::Timed {
            starts_at,
            ends_at: starts_at + chrono::Duration::minutes(30),
            time_zone: Some("America/New_York".to_owned()),
        },
        recurrence_lines: vec!["RRULE:FREQ=DAILY".to_owned()],
        organizer_email: Some("owner@example.com".to_owned()),
        organizer_name: None,
        creator_email: None,
        creator_name: None,
        conference_url: None,
        conference_provider: None,
        sequence: 2,
        is_read_only: false,
        attendees: vec![attendee(
            "owner@example.com",
            AttendeeResponseStatus::Accepted,
        )],
        reminders: EventReminders::default(),
        created_at: starts_at,
        updated_at: starts_at,
    }
}

pub(crate) fn timed_listing(day: u32) -> OccurrenceListing {
    let starts_at = Utc.with_ymd_and_hms(2026, 10, day, 15, 0, 0).unwrap();
    let time = EventTime::Timed {
        starts_at,
        ends_at: starts_at + chrono::Duration::minutes(30),
        time_zone: None,
    };
    OccurrenceListing {
        event: series_event(),
        occurrence: CalendarOccurrence {
            event_id: EVENT_ID,
            occurrence_key: time.occurrence_key(),
            recurrence_id: Some(format!("{EVENT_ID}_{day}")),
            time,
            is_cancelled: false,
        },
        link_id: LINK_ID,
        exception: OccurrenceException::default(),
    }
}
