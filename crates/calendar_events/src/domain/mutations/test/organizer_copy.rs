//! Events organized by a calendar the inbox can write, such as its own
//! secondary calendar: what a new one lists, and which copy takes each
//! change once the inbox's primary calendar holds an invitation to it.
use super::*;
use crate::domain::models::CalendarProvider;

/// The id Google gives a secondary calendar, which it names as the organizer
/// of the events made on it.
const SECONDARY: &str = "c_0123abcd@group.calendar.google.com";
const INVITATION_CALENDAR: Uuid = Uuid::from_u128(0xa);
const ORGANIZER_CALENDAR: Uuid = Uuid::from_u128(0xb);

fn actor() -> Option<ActorInboxes> {
    ActorInboxes::from_owned(vec![OwnedInbox {
        writable_calendar_ids: vec!["self@example.com".to_string(), SECONDARY.to_string()],
        ..owned(SELF_LINK, "self@example.com")
    }])
}

/// The invitation the secondary calendar sent the inbox's primary calendar:
/// the entity's canonical copy, which the web addresses.
fn invitation() -> CalendarEventMutationTarget {
    CalendarEventMutationTarget {
        calendar_id: INVITATION_CALENDAR,
        provider_calendar_id: "self@example.com".to_string(),
        organizer_email: Some(SECONDARY.to_string()),
        actor: actor(),
        organizer_copy_calendar_id: Some(ORGANIZER_CALENDAR),
        ..mutation_target(false)
    }
}

/// The organizer's own copy, on the secondary calendar.
fn organizer_copy(account_id: Uuid) -> CalendarEventMutationTarget {
    CalendarEventMutationTarget {
        calendar_id: ORGANIZER_CALENDAR,
        provider_calendar_id: SECONDARY.to_string(),
        organizer_copy_calendar_id: None,
        account_id,
        ..invitation()
    }
}

fn repo() -> FakeRepo {
    let invitation = invitation();
    FakeRepo {
        copy_targets: vec![organizer_copy(invitation.account_id)],
        mutation_target: Some(invitation),
        stored_attendees: vec![echo_attendee("self@example.com", false)],
        persisted_event_id: Some(Uuid::now_v7()),
        ..FakeRepo::default()
    }
}

fn written_calendars(upserts: &Mutex<Vec<CalendarEventUpsert>>) -> Vec<Uuid> {
    upserts
        .lock()
        .unwrap()
        .iter()
        .map(|upsert| upsert.source.details().calendar_id)
        .collect()
}

fn reminders() -> EventReminders {
    EventReminders {
        use_default: false,
        overrides: Vec::new(),
    }
}

#[tokio::test]
async fn a_title_change_goes_through_the_organizer_copy_and_reads_the_invitation_back() {
    let repo = repo();
    let upserts = repo.upserts.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let patches = provider.updated_patches.clone();

    service(repo, provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            Some(INVITATION_CALENDAR),
            CalendarEventPatch {
                title: Some("Renamed".to_string()),
                ..CalendarEventPatch::default()
            },
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();

    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["update:master-id", "refresh:self@example.com:master-id"]
    );
    assert_eq!(patches.lock().unwrap()[0].title.as_deref(), Some("Renamed"));
    assert_eq!(
        written_calendars(&upserts),
        [ORGANIZER_CALENDAR, INVITATION_CALENDAR]
    );
}

#[tokio::test]
async fn reminders_saved_with_a_title_stay_on_the_invitation() {
    let repo = repo();
    let upserts = repo.upserts.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let patches = provider.updated_patches.clone();

    service(repo, provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            Some(INVITATION_CALENDAR),
            CalendarEventPatch {
                title: Some("Renamed".to_string()),
                reminders: Some(reminders()),
                ..CalendarEventPatch::default()
            },
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();

    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["update:master-id", "update:master-id"]
    );
    assert_eq!(
        patches.lock().unwrap().as_slice(),
        [
            CalendarEventPatch {
                title: Some("Renamed".to_string()),
                ..CalendarEventPatch::default()
            },
            CalendarEventPatch {
                reminders: Some(reminders()),
                ..CalendarEventPatch::default()
            },
        ]
    );
    assert_eq!(
        written_calendars(&upserts),
        [ORGANIZER_CALENDAR, INVITATION_CALENDAR]
    );
}

#[tokio::test]
async fn reminders_alone_stay_on_the_invitation() {
    let repo = repo();
    let upserts = repo.upserts.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    service(repo, provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            Some(INVITATION_CALENDAR),
            CalendarEventPatch {
                reminders: Some(reminders()),
                ..CalendarEventPatch::default()
            },
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();

    assert_eq!(calls.lock().unwrap().as_slice(), ["update:master-id"]);
    assert_eq!(written_calendars(&upserts), [INVITATION_CALENDAR]);
}

#[tokio::test]
async fn guests_are_added_through_the_organizer_copy() {
    let repo = repo();
    let upserts = repo.upserts.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    service(repo, provider, FakeTokens::ok())
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            Some(INVITATION_CALENDAR),
            vec![CalendarAttendeeInput {
                email: "ada@example.com".to_string(),
                is_optional: false,
                response_status: None,
            }],
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();

    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["invite:master-id:all", "refresh:self@example.com:master-id"]
    );
    assert_eq!(
        written_calendars(&upserts),
        [ORGANIZER_CALENDAR, INVITATION_CALENDAR]
    );
}

#[tokio::test]
async fn deleting_cancels_through_the_organizer_copy_and_retires_the_invitation() {
    let repo = repo();
    let account_id = repo.mutation_target.as_ref().unwrap().account_id;
    let removed = repo.removed_sources.clone();
    let mut provider = FakeProvider::new(FakeProviderBehavior::Echo);
    provider.refresh_gone = true;
    let calls = provider.calls.clone();

    service(repo, provider, FakeTokens::ok())
        .delete_event(
            "macro|user",
            Uuid::now_v7(),
            Some(INVITATION_CALENDAR),
            CalendarDeletionScope::All,
        )
        .await
        .unwrap();

    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["delete:master-id", "refresh:self@example.com:master-id"]
    );
    assert_eq!(
        removed.lock().unwrap().as_slice(),
        [
            (account_id, ORGANIZER_CALENDAR, "master-id".to_string()),
            (account_id, INVITATION_CALENDAR, "master-id".to_string()),
        ]
    );
}

#[tokio::test]
async fn an_answer_stays_on_the_invitation() {
    let repo = repo();
    let upserts = repo.upserts.clone();
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    service(repo, provider, FakeTokens::ok())
        .respond_to_event(
            "macro|user",
            Uuid::now_v7(),
            Some(INVITATION_CALENDAR),
            AttendeeResponseStatus::Accepted,
            CalendarRsvpScope::All,
            None,
        )
        .await
        .unwrap();

    assert_eq!(calls.lock().unwrap().as_slice(), ["rsvp:master-id:all"]);
    assert_eq!(written_calendars(&upserts), [INVITATION_CALENDAR]);
}

fn secondary_calendar(provider: CalendarProvider) -> CalendarCreationTarget {
    CalendarCreationTarget {
        provider_calendar_id: SECONDARY.to_string(),
        is_primary: false,
        token_identity: CalendarLinkTokenIdentity {
            provider,
            ..token_identity()
        },
        ..creation_target(false)
    }
}

async fn created_attendees(
    target: CalendarCreationTarget,
    attendees: Vec<CalendarAttendeeInput>,
) -> Vec<CalendarAttendeeInput> {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let drafts = provider.created_drafts.clone();
    service(
        FakeRepo {
            creation_target: Some(target),
            persisted_event_id: Some(Uuid::now_v7()),
            ..FakeRepo::default()
        },
        provider,
        FakeTokens::ok(),
    )
    .create_event(
        "macro|user",
        None,
        None,
        CalendarEventDraft {
            attendees,
            ..draft()
        },
    )
    .await
    .unwrap();
    drafts.lock().unwrap()[0].attendees.clone()
}

fn invitee(email: &str) -> CalendarAttendeeInput {
    CalendarAttendeeInput {
        email: email.to_string(),
        is_optional: false,
        response_status: None,
    }
}

#[tokio::test]
async fn an_event_of_ones_own_on_a_secondary_calendar_invites_no_one() {
    let attendees =
        created_attendees(secondary_calendar(CalendarProvider::Google), Vec::new()).await;

    assert_eq!(attendees, []);
}

#[tokio::test]
async fn a_meeting_on_a_secondary_calendar_invites_its_creator_too() {
    let attendees = created_attendees(
        secondary_calendar(CalendarProvider::Google),
        vec![invitee("ada@example.com")],
    )
    .await;

    assert_eq!(
        attendees,
        [
            CalendarAttendeeInput {
                response_status: Some(AttendeeResponseStatus::Accepted),
                ..invitee("self@example.com")
            },
            invitee("ada@example.com"),
        ]
    );
}

#[tokio::test]
async fn an_outlook_mailbox_organizes_an_event_on_any_of_its_calendars() {
    // Graph names the mailbox as the organizer of every calendar's events,
    // and never invites the organizer to its own meeting.
    let attendees =
        created_attendees(secondary_calendar(CalendarProvider::Outlook), Vec::new()).await;

    assert_eq!(
        attendees,
        [CalendarAttendeeInput {
            response_status: Some(AttendeeResponseStatus::Accepted),
            ..invitee("self@example.com")
        }]
    );
}
