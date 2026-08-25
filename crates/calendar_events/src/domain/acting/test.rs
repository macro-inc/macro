use super::*;
use crate::domain::models::{AttendeeResponseStatus, CalendarAttendee};

fn token(email: &str) -> CalendarLinkTokenIdentity {
    CalendarLinkTokenIdentity {
        fusionauth_user_id: "fusion-user".to_string(),
        email_address: email.to_string(),
        provider: "GMAIL".to_string(),
    }
}

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
fn as_self_actor_always_contains_the_account_address() {
    let acting = CalendarActingIdentity::as_self(
        token("self@example.com"),
        vec!["jackson@example.com".to_string()],
    );
    let actor = acting.actor().expect("AsSelf always has an actor");
    assert!(actor.matches("self@example.com"));
    assert!(actor.matches("jackson@example.com"));
}

#[test]
fn as_self_with_no_owned_inboxes_falls_back_to_the_account_address() {
    let acting = CalendarActingIdentity::as_self(token("self@example.com"), Vec::new());
    let actor = acting.actor().expect("AsSelf always has an actor");
    assert!(actor.matches("self@example.com"));
    assert_eq!(actor.iter().collect::<Vec<_>>(), ["self@example.com"]);
}

#[test]
fn on_behalf_actor_never_contains_the_subject_address() {
    let acting = CalendarActingIdentity::on_behalf_of(
        token("jacob@example.com"),
        vec!["jackson@example.com".to_string()],
    );
    let actor = acting.actor().expect("the requester owns an inbox");
    assert!(actor.matches("jackson@example.com"));
    assert!(!actor.matches("jacob@example.com"));
    assert_eq!(acting.token_identity().email_address, "jacob@example.com");
}

#[test]
fn on_behalf_with_no_owned_inboxes_has_no_actor() {
    let acting = CalendarActingIdentity::on_behalf_of(token("jacob@example.com"), Vec::new());
    assert!(acting.actor().is_none());
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
