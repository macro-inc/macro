use chrono::{TimeZone, Utc};
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    ActorInboxes, AttendeeResponseStatus, CalendarAttendee, EventReminders, EventTime,
    EventTransparency, EventType, EventVisibility,
};

const ORGANIZER: &str = "olivia@example.com";
const GUEST: &str = "jacob@example.com";

fn google(email: &str) -> OwnedInbox {
    OwnedInbox {
        link_id: Uuid::from_u128(1),
        email: email.to_string(),
        provider: CalendarProvider::Google,
    }
}

fn attendee(email: &str, is_organizer: bool) -> CalendarAttendee {
    CalendarAttendee {
        email: email.to_string(),
        display_name: None,
        response_status: AttendeeResponseStatus::NeedsAction,
        is_organizer,
        is_optional: false,
        is_self: false,
        comment: None,
    }
}

fn event(attendees: Vec<CalendarAttendee>, guest_policy: GuestPolicy) -> CalendarEvent {
    CalendarEvent {
        id: Uuid::from_u128(7),
        owner_id: "macro|jacob@example.com".to_string(),
        ical_uid: "uid-1".to_string(),
        calendar_id: Some(Uuid::from_u128(9)),
        sources: Vec::new(),
        title: "Planning".to_string(),
        description: None,
        location: None,
        status: EventStatus::Confirmed,
        visibility: EventVisibility::Default,
        transparency: EventTransparency::Opaque,
        event_type: EventType::Default,
        time: EventTime::Timed {
            starts_at: Utc.with_ymd_and_hms(2026, 10, 22, 17, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2026, 10, 22, 18, 0, 0).unwrap(),
            time_zone: None,
        },
        recurrence_lines: Vec::new(),
        organizer_email: Some(ORGANIZER.to_string()),
        organizer_name: None,
        creator_email: None,
        creator_name: None,
        conference_url: None,
        conference_provider: None,
        sequence: 0,
        is_read_only: false,
        attendees,
        reminders: EventReminders::default(),
        guest_policy,
        is_snapshot: false,
        viewer_can: ViewerCapabilities::NONE,
        created_at: Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap(),
    }
}

fn meeting(guest_policy: GuestPolicy) -> CalendarEvent {
    event(
        vec![attendee(ORGANIZER, true), attendee(GUEST, false)],
        guest_policy,
    )
}

const EVERYTHING: ViewerCapabilities = ViewerCapabilities {
    edit_details: true,
    invite_guests: true,
    remove_guests: true,
    set_guest_policy: true,
    rsvp: true,
    organize: true,
};

const LOCKED_DOWN: GuestPolicy = GuestPolicy {
    can_modify: false,
    can_invite_others: false,
    can_see_other_guests: false,
};

#[test]
fn the_organizer_may_do_everything() {
    let capabilities =
        ViewerCapabilities::for_event(&meeting(LOCKED_DOWN), Some(&google("Olivia@Example.com")));

    assert_eq!(capabilities, EVERYTHING);
}

#[test]
fn an_organizer_attendee_row_counts_without_the_organizer_email() {
    let mut event = meeting(LOCKED_DOWN);
    event.organizer_email = None;

    let capabilities = ViewerCapabilities::for_event(&event, Some(&google(ORGANIZER)));

    assert_eq!(capabilities, EVERYTHING);
}

#[test]
fn an_organizer_without_an_attendee_row_cannot_answer() {
    let event = event(vec![attendee(GUEST, false)], LOCKED_DOWN);

    let capabilities = ViewerCapabilities::for_event(&event, Some(&google(ORGANIZER)));

    assert_eq!(
        capabilities,
        ViewerCapabilities {
            rsvp: false,
            ..EVERYTHING
        }
    );
}

#[test]
fn a_writable_event_without_attendees_is_the_actors_own() {
    let event = event(Vec::new(), LOCKED_DOWN);

    let capabilities = ViewerCapabilities::for_event(&event, Some(&google(GUEST)));

    assert_eq!(
        capabilities,
        ViewerCapabilities {
            rsvp: false,
            ..EVERYTHING
        }
    );
}

#[test]
fn a_snapshot_allows_nothing_although_its_owner_is_its_guest() {
    // A snapshot lists its owner, already accepted, as its only guest so
    // Google imports it; answering or inviting from it reaches no one.
    let mut snapshot = event(
        vec![CalendarAttendee {
            response_status: AttendeeResponseStatus::Accepted,
            ..attendee(GUEST, false)
        }],
        GuestPolicy::default(),
    );
    snapshot.is_snapshot = true;

    let capabilities = ViewerCapabilities::for_event(&snapshot, Some(&google(GUEST)));

    assert_eq!(capabilities, ViewerCapabilities::NONE);
}

#[test]
fn a_guest_who_may_modify_may_do_everything_but_set_the_policy() {
    let policy = GuestPolicy {
        can_modify: true,
        can_invite_others: false,
        can_see_other_guests: true,
    };

    let capabilities = ViewerCapabilities::for_event(&meeting(policy), Some(&google(GUEST)));

    assert_eq!(
        capabilities,
        ViewerCapabilities {
            set_guest_policy: false,
            organize: false,
            ..EVERYTHING
        }
    );
}

#[test]
fn a_guest_who_may_invite_may_add_guests_and_answer() {
    let capabilities =
        ViewerCapabilities::for_event(&meeting(GuestPolicy::default()), Some(&google(GUEST)));

    assert_eq!(
        capabilities,
        ViewerCapabilities {
            invite_guests: true,
            rsvp: true,
            ..ViewerCapabilities::NONE
        }
    );
}

#[test]
fn a_guest_cannot_change_a_hidden_guest_list_even_with_permission() {
    let capabilities = ViewerCapabilities::for_event(
        &meeting(GuestPolicy {
            can_modify: true,
            can_invite_others: true,
            can_see_other_guests: false,
        }),
        Some(&google(GUEST)),
    );

    assert_eq!(
        capabilities,
        ViewerCapabilities {
            edit_details: true,
            invite_guests: false,
            remove_guests: false,
            set_guest_policy: false,
            rsvp: true,
            organize: false,
        }
    );
}

#[test]
fn a_guest_without_permissions_may_only_answer() {
    let capabilities = ViewerCapabilities::for_event(&meeting(LOCKED_DOWN), Some(&google(GUEST)));

    assert_eq!(
        capabilities,
        ViewerCapabilities {
            rsvp: true,
            ..ViewerCapabilities::NONE
        }
    );
}

#[test]
fn a_read_only_event_allows_nothing_even_to_its_organizer() {
    let mut event = meeting(GuestPolicy::default());
    event.is_read_only = true;

    assert!(ViewerCapabilities::for_event(&event, Some(&google(ORGANIZER))).is_none());
    assert!(ViewerCapabilities::for_event(&event, Some(&google(GUEST))).is_none());
}

#[test]
fn a_cancelled_event_allows_nothing() {
    let mut event = meeting(GuestPolicy::default());
    event.status = EventStatus::Cancelled;

    assert!(ViewerCapabilities::for_event(&event, Some(&google(ORGANIZER))).is_none());
    assert!(ViewerCapabilities::for_event(&event, Some(&google(GUEST))).is_none());
}

#[test]
fn someone_neither_organizing_nor_invited_may_do_nothing() {
    let capabilities = ViewerCapabilities::for_event(
        &meeting(GuestPolicy {
            can_modify: true,
            can_invite_others: true,
            can_see_other_guests: true,
        }),
        Some(&google("teammate@example.com")),
    );

    assert!(capabilities.is_none());
}

#[test]
fn a_delegate_may_do_nothing_with_a_meeting_on_the_inbox_they_were_granted() {
    let capabilities = ViewerCapabilities::for_event(&meeting(GuestPolicy::default()), None);

    assert!(capabilities.is_none());
}

#[test]
fn a_delegate_may_change_a_writable_event_without_attendees_but_not_its_guest_policy() {
    let capabilities = ViewerCapabilities::for_event(&event(Vec::new(), LOCKED_DOWN), None);

    assert_eq!(
        capabilities,
        ViewerCapabilities {
            rsvp: false,
            set_guest_policy: false,
            ..EVERYTHING
        },
        "without the copy's inbox its provider, and so its guest policy, is unknown"
    );
}

const ORGANIZER_LINK: Uuid = Uuid::from_u128(11);
const GUEST_LINK: Uuid = Uuid::from_u128(12);
const OUTLOOK_LINK: Uuid = Uuid::from_u128(13);
const OUTLOOK: &str = "jacob@contoso.onmicrosoft.com";

/// Jacob, who connected the organizer's Google inbox, his own Google inbox,
/// and an Outlook inbox.
fn three_inboxes() -> ActorInboxes {
    ActorInboxes::from_owned(vec![
        OwnedInbox {
            link_id: ORGANIZER_LINK,
            email: ORGANIZER.to_string(),
            provider: CalendarProvider::Google,
        },
        OwnedInbox {
            link_id: GUEST_LINK,
            email: GUEST.to_string(),
            provider: CalendarProvider::Google,
        },
        OwnedInbox {
            link_id: OUTLOOK_LINK,
            email: OUTLOOK.to_string(),
            provider: CalendarProvider::Outlook,
        },
    ])
    .expect("the actor owns inboxes")
}

/// Olivia's meeting with both of Jacob's other inboxes invited.
fn meeting_with_every_inbox(guest_policy: GuestPolicy) -> CalendarEvent {
    event(
        vec![
            attendee(ORGANIZER, true),
            attendee(GUEST, false),
            attendee(OUTLOOK, false),
        ],
        guest_policy,
    )
}

#[test]
fn the_organizers_google_copy_may_do_everything() {
    let mut copy = meeting_with_every_inbox(LOCKED_DOWN);

    three_inboxes().mark_event(&mut copy, ORGANIZER_LINK);

    assert_eq!(copy.viewer_can, EVERYTHING);
    let own_rows: Vec<&str> = copy
        .attendees
        .iter()
        .filter(|attendee| attendee.is_self)
        .map(|attendee| attendee.email.as_str())
        .collect();
    assert_eq!(own_rows, [ORGANIZER]);
}

#[test]
fn a_google_guest_copy_follows_the_policy_although_another_inbox_organizes() {
    let mut copy = meeting_with_every_inbox(NO_INVITES);

    three_inboxes().mark_event(&mut copy, GUEST_LINK);

    assert_eq!(
        copy.viewer_can,
        ViewerCapabilities {
            rsvp: true,
            ..ViewerCapabilities::NONE
        },
        "the copy is written through the guest's grant, so the organizing inbox lends it nothing"
    );
    let own_rows: Vec<&str> = copy
        .attendees
        .iter()
        .filter(|attendee| attendee.is_self)
        .map(|attendee| attendee.email.as_str())
        .collect();
    assert_eq!(own_rows, [GUEST]);
}

#[test]
fn an_outlook_guest_copy_of_a_google_meeting_may_only_answer() {
    let mut copy = meeting_with_every_inbox(GuestPolicy {
        can_modify: true,
        can_invite_others: true,
        can_see_other_guests: true,
    });

    three_inboxes().mark_event(&mut copy, OUTLOOK_LINK);

    assert_eq!(
        copy.viewer_can,
        ViewerCapabilities {
            rsvp: true,
            ..ViewerCapabilities::NONE
        }
    );
}

#[test]
fn an_outlook_organizer_copy_may_do_everything_but_set_a_guest_policy() {
    let mut copy = event(
        vec![attendee(OUTLOOK, true), attendee(GUEST, false)],
        GuestPolicy::default(),
    );
    copy.organizer_email = Some(OUTLOOK.to_string());

    three_inboxes().mark_event(&mut copy, OUTLOOK_LINK);

    assert_eq!(
        copy.viewer_can,
        ViewerCapabilities {
            set_guest_policy: false,
            ..EVERYTHING
        },
        "Outlook has no guest policy, but its organizer still organizes"
    );
}

const NO_INVITES: GuestPolicy = GuestPolicy {
    can_modify: false,
    can_invite_others: false,
    can_see_other_guests: true,
};
