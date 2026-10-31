use super::*;
use crate::domain::models::{
    AttendeeResponseStatus, CalendarCapabilities, CalendarProvider, OwnedInbox,
};

const INBOX: &str = "owner@example.com";
const COLLEAGUE: &str = "colleague@example.com";
const LINK: Uuid = Uuid::from_u128(1);
const OWN: Uuid = Uuid::from_u128(10);
const COLLEAGUES: Uuid = Uuid::from_u128(11);
const HOLIDAYS: Uuid = Uuid::from_u128(12);

fn calendar(id: Uuid, name: &str, on_schedule: bool) -> VisibleCalendar {
    VisibleCalendar {
        provider: CalendarProvider::Google,
        capabilities: CalendarCapabilities::google(),
        id,
        email_link_id: LINK,
        email_address: INBOX.to_string(),
        name: name.to_string(),
        color: None,
        is_primary: id == OWN,
        is_writable: id != HOLIDAYS,
        is_subscription: false,
        contributes_to_availability: on_schedule,
        sync_error: None,
        default_reminders: Vec::new(),
    }
}

fn calendars() -> CalendarLabels {
    CalendarLabels::from_calendars(vec![
        calendar(OWN, INBOX, true),
        calendar(COLLEAGUES, COLLEAGUE, false),
        calendar(HOLIDAYS, "United States holidays", false),
    ])
}

/// The owner of `INBOX`, who can write the colleague's calendar as an inbox
/// with manage rights there can.
fn viewer() -> ActorInboxes {
    ActorInboxes::from_owned(vec![OwnedInbox {
        link_id: LINK,
        email: INBOX.to_string(),
        provider: CalendarProvider::Google,
        writable_calendar_ids: vec![INBOX.to_string(), COLLEAGUE.to_string()],
    }])
    .expect("one inbox")
}

/// A guest row with the `is_self` Google sync stores for the inbox it synced
/// through, which says nothing about whoever reads the row later.
fn attendee(email: &str, is_organizer: bool) -> CalendarAttendee {
    CalendarAttendee {
        email: email.to_string(),
        display_name: None,
        response_status: AttendeeResponseStatus::Accepted,
        is_organizer,
        is_optional: false,
        is_self: true,
        comment: None,
    }
}

fn copy(calendar_id: Uuid, organizer: &str, attendees: Vec<CalendarAttendee>) -> EventCopy {
    EventCopy {
        event_id: Uuid::from_u128(7),
        link_id: LINK,
        status: EventStatus::Confirmed,
        organizer_email: Some(organizer.to_string()),
        is_read_only: false,
        is_snapshot: false,
        guest_policy: GuestPolicy::default(),
        attendees,
        calendar_ids: vec![calendar_id],
    }
}

#[test]
fn a_colleagues_calendar_says_so_and_gives_no_role() {
    let solo = EventLabels::of(
        copy(COLLEAGUES, COLLEAGUE, Vec::new()),
        Some(&viewer()),
        &calendars(),
    );
    assert_eq!(
        solo,
        EventLabels {
            calendar_name: Some(COLLEAGUE.to_string()),
            contributes_to_availability: Some(false),
            inbox: Some(INBOX.to_string()),
            role: None,
        },
        "writing their calendar makes the user neither organizer nor guest"
    );

    let meeting = copy(COLLEAGUES, COLLEAGUE, vec![attendee(COLLEAGUE, true)]);
    assert_eq!(
        EventLabels::of(meeting, Some(&viewer()), &calendars()).role,
        None,
        "their meeting, seen on their calendar"
    );
}

/// Microsoft Graph names the mailbox owner as organizer on every event of a
/// read-only calendar such as Outlook's holidays.
#[test]
fn a_read_only_calendar_naming_the_user_gives_no_role() {
    let holiday = EventCopy {
        is_read_only: true,
        ..copy(HOLIDAYS, INBOX, vec![attendee(INBOX, true)])
    };
    assert_eq!(
        EventLabels::of(holiday, Some(&viewer()), &calendars()),
        EventLabels {
            calendar_name: Some("United States holidays".to_string()),
            contributes_to_availability: Some(false),
            inbox: Some(INBOX.to_string()),
            role: None,
        },
    );
}

#[test]
fn a_real_organizer_and_guest_keep_their_roles() {
    let organized = copy(
        OWN,
        INBOX,
        vec![attendee(INBOX, true), attendee(COLLEAGUE, false)],
    );
    assert_eq!(
        EventLabels::of(organized, Some(&viewer()), &calendars()).role,
        Some(EventRole::Organizer)
    );

    let invited = copy(
        OWN,
        COLLEAGUE,
        vec![attendee(COLLEAGUE, true), attendee(INBOX, false)],
    );
    assert_eq!(
        EventLabels::of(invited, Some(&viewer()), &calendars()).role,
        Some(EventRole::Guest)
    );

    assert_eq!(
        EventLabels::of(copy(OWN, INBOX, Vec::new()), Some(&viewer()), &calendars()).role,
        Some(EventRole::Organizer),
        "an own event without guests"
    );
}

/// The copy rules add guests from the copy the user organizes, so that copy
/// keeps its role off availability, as it does for the calendar tools.
#[test]
fn an_organizer_row_counts_off_availability() {
    let off = CalendarLabels::from_calendars(vec![calendar(OWN, INBOX, false)]);
    let organized = copy(OWN, INBOX, vec![attendee(INBOX, true)]);
    let labels = EventLabels::of(organized, Some(&viewer()), &off);
    assert_eq!(labels.contributes_to_availability, Some(false));
    assert_eq!(labels.role, Some(EventRole::Organizer));
}

#[test]
fn one_copy_on_the_schedule_is_enough() {
    let both = EventCopy {
        calendar_ids: vec![COLLEAGUES, OWN],
        ..copy(COLLEAGUES, COLLEAGUE, Vec::new())
    };
    let labels = EventLabels::of(both, Some(&viewer()), &calendars());
    assert_eq!(labels.contributes_to_availability, Some(true));
    assert_eq!(
        labels.calendar_name.as_deref(),
        Some(COLLEAGUE),
        "the row names the copy its event reports first"
    );
}

/// A channel share is someone else's copy on none of the reader's calendars,
/// so nothing about it may read as theirs.
#[test]
fn a_copy_on_none_of_their_calendars_says_nothing() {
    let shared = EventCopy {
        link_id: Uuid::from_u128(2),
        ..copy(
            Uuid::from_u128(99),
            COLLEAGUE,
            vec![attendee(COLLEAGUE, true)],
        )
    };
    assert_eq!(
        EventLabels::of(shared.clone(), Some(&viewer()), &calendars()),
        EventLabels::default()
    );
    assert_eq!(
        EventLabels::of(shared, None, &calendars()),
        EventLabels::default(),
        "the sharer's stored row is not the reader's, with or without an inbox"
    );
}

#[test]
fn a_cancelled_copy_gives_no_organizer_capability() {
    let cancelled = EventCopy {
        status: EventStatus::Cancelled,
        ..copy(OWN, INBOX, Vec::new())
    };
    assert_eq!(
        EventLabels::of(cancelled, Some(&viewer()), &calendars()).role,
        None
    );
}

#[test]
fn a_requester_with_no_inbox_of_their_own_gets_no_role() {
    let labels = EventLabels::of(
        copy(OWN, INBOX, vec![attendee(INBOX, true)]),
        None,
        &calendars(),
    );
    assert_eq!(labels.calendar_name.as_deref(), Some(INBOX));
    assert_eq!(labels.role, None);
}
