use async_graphql::ID;
use calendar_events::domain::models::{
    AttendeeResponseStatus, EventStatus, EventTime, OccurrenceException,
};
use chrono::NaiveDate;

use super::*;
use crate::test_fixtures::{EVENT_ID, LINK_ID, attendee, timed_listing};

#[test]
fn occurrence_identity_composes_event_id_and_occurrence_key() {
    let listing = timed_listing(7);
    let key = listing.occurrence.occurrence_key.clone();

    let occurrence = occurrence_nodes(vec![listing]).remove(0);

    assert_eq!(occurrence.id, ID(format!("{EVENT_ID}:{key}")));
    assert_eq!(occurrence.event_id, ID(EVENT_ID.to_string()));
    assert_eq!(occurrence.link_id, ID(LINK_ID.to_string()));
    assert_eq!(occurrence.event.id, ID(EVENT_ID.to_string()));
    assert_eq!(occurrence.event.link_id, ID(LINK_ID.to_string()));
}

#[test]
fn exception_stays_on_the_occurrence_and_the_event_keeps_series_content() {
    let mut listing = timed_listing(7);
    listing.exception = OccurrenceException {
        title: Some("Moved standup".to_owned()),
        description: Some("Room B".to_owned()),
        location: None,
        status: Some(EventStatus::Tentative),
        attendees: Some(vec![attendee(
            "owner@example.com",
            AttendeeResponseStatus::Declined,
        )]),
    };

    let occurrence = occurrence_nodes(vec![listing]).remove(0);

    assert_eq!(occurrence.event.title, "Standup");
    assert_eq!(
        occurrence.event.attendees[0].response_status,
        GraphqlCalendarAttendeeResponseStatus::Accepted
    );
    assert_eq!(occurrence.override_title.as_deref(), Some("Moved standup"));
    assert_eq!(occurrence.override_description.as_deref(), Some("Room B"));
    assert_eq!(occurrence.override_location, None);
    assert_eq!(
        occurrence.override_status,
        Some(GraphqlCalendarEventStatus::Tentative)
    );
    let override_attendees = occurrence.override_attendees.expect("override attendees");
    assert_eq!(
        override_attendees[0].response_status,
        GraphqlCalendarAttendeeResponseStatus::Declined
    );
}

#[test]
fn occurrence_without_exception_inherits_everything() {
    let occurrence = occurrence_nodes(vec![timed_listing(8)]).remove(0);

    assert_eq!(occurrence.override_title, None);
    assert_eq!(occurrence.override_status, None);
    assert_eq!(occurrence.override_attendees, None);
}

#[test]
fn time_union_maps_both_shapes() {
    let timed = GraphqlEventTime::from(timed_listing(7).occurrence.time);
    assert_eq!(
        timed,
        GraphqlEventTime::Timed(GraphqlTimedEventTime {
            starts_at: "2026-10-07T15:00:00+00:00".to_owned(),
            ends_at: "2026-10-07T15:30:00+00:00".to_owned(),
            time_zone: None,
        })
    );

    let all_day = GraphqlEventTime::from(EventTime::AllDay {
        start_date: NaiveDate::from_ymd_opt(2026, 10, 7).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 10, 9).unwrap(),
    });
    assert_eq!(
        all_day,
        GraphqlEventTime::AllDay(GraphqlAllDayEventTime {
            start_date: "2026-10-07".to_owned(),
            end_date: "2026-10-09".to_owned(),
        })
    );
}

#[test]
fn visible_calendar_maps_its_link() {
    let calendar = GraphqlCalendar::from(VisibleCalendar {
        id: uuid::Uuid::from_u128(5),
        email_link_id: LINK_ID,
        email_address: "owner@example.com".to_owned(),
        name: "Work".to_owned(),
        color: Some("#0b8043".to_owned()),
        is_primary: true,
        is_writable: true,
        is_subscription: false,
        sync_error: None,
        default_reminders: vec![EventReminderOverride {
            method: "popup".to_owned(),
            minutes: 10,
        }],
    });

    assert_eq!(calendar.id, ID(uuid::Uuid::from_u128(5).to_string()));
    assert_eq!(calendar.link_id, ID(LINK_ID.to_string()));
    assert_eq!(calendar.default_reminders[0].minutes, 10);
}
