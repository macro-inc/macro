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

fn inbox(link_id: u128, email: &str) -> OwnedInbox {
    OwnedInbox {
        link_id: Uuid::from_u128(link_id),
        email: email.to_string(),
        provider: CalendarProvider::Google,
    }
}

#[test]
fn from_owned_empty_is_none() {
    assert!(ActorInboxes::from_owned(Vec::new()).is_none());
}

#[test]
fn from_owned_does_not_add_addresses_that_were_not_supplied() {
    let actor = ActorInboxes::from_owned(vec![inbox(1, "jackson@example.com")])
        .expect("owned addresses remain after normalize");
    assert!(actor.matches("jackson@example.com"));
    assert!(!actor.matches("jacob@example.com"));
}

#[test]
fn actor_inboxes_dedupe_and_match_case_insensitively() {
    let actor = ActorInboxes::from_owned(vec![
        inbox(1, "Jackson@example.com"),
        inbox(1, "jackson@example.com"),
        inbox(1, "JACKSON@example.com"),
    ])
    .expect("owned addresses remain after normalize");
    assert!(actor.matches("JACKSON@EXAMPLE.COM"));
    assert_eq!(actor.iter().collect::<Vec<_>>(), ["jackson@example.com"]);
}

#[test]
fn mark_attendees_marks_only_the_copys_inbox() {
    let actor = ActorInboxes::from_owned(vec![
        inbox(1, "jackson@example.com"),
        inbox(2, "jacob@example.com"),
    ])
    .expect("owned addresses remain after normalize");
    let mut attendees = vec![
        attendee("jacob@example.com", true),
        attendee("jackson@example.com", false),
        attendee("olivia@example.com", true),
    ];
    actor.mark_attendees(&mut attendees, Uuid::from_u128(1));
    assert!(
        !attendees[0].is_self,
        "another owned inbox is not this copy's"
    );
    assert!(attendees[1].is_self);
    assert!(!attendees[2].is_self);
}

#[test]
fn a_copy_of_an_inbox_the_actor_does_not_own_marks_nobody() {
    let actor = ActorInboxes::from_owned(vec![inbox(1, "jackson@example.com")])
        .expect("owned addresses remain after normalize");
    let mut attendees = vec![attendee("jackson@example.com", true)];
    actor.mark_attendees(&mut attendees, Uuid::from_u128(9));
    assert!(!attendees[0].is_self);
}
