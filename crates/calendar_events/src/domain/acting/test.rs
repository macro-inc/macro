use super::*;
use crate::domain::models::{AttendeeResponseStatus, CalendarAttendee};

fn attendee(email: &str, is_self: bool) -> CalendarAttendee {
    CalendarAttendee {
        email: email.to_string(),
        display_name: None,
        response_status: AttendeeResponseStatus::NeedsAction,
        is_organizer: false,
        is_optional: false,
        is_self,
        comment: None,
    }
}

#[test]
fn from_owned_empty_is_none() {
    assert!(ActorInboxes::from_owned(Vec::new()).is_none());
}

#[test]
fn from_owned_does_not_add_addresses_that_were_not_supplied() {
    let actor = ActorInboxes::from_owned(vec!["jackson@example.com".to_string()])
        .expect("owned addresses remain after normalize");
    assert!(actor.matches("jackson@example.com"));
    assert!(!actor.matches("jacob@example.com"));
}

#[test]
fn actor_inboxes_dedupe_and_match_case_insensitively() {
    let actor = ActorInboxes::from_owned(vec![
        "Jackson@example.com".to_string(),
        "jackson@example.com".to_string(),
        "JACKSON@example.com".to_string(),
    ])
    .expect("owned addresses remain after normalize");
    assert!(actor.matches("JACKSON@EXAMPLE.COM"));
    assert_eq!(actor.iter().collect::<Vec<_>>(), ["jackson@example.com"]);
}

#[test]
fn mark_attendees_marks_owned_rows_and_clears_others() {
    let actor = ActorInboxes::from_owned(vec!["jackson@example.com".to_string()])
        .expect("owned addresses remain after normalize");
    let mut attendees = vec![
        attendee("jacob@example.com", true),
        attendee("jackson@example.com", false),
    ];
    actor.mark_attendees(&mut attendees);
    assert!(!attendees[0].is_self);
    assert!(attendees[1].is_self);
}
