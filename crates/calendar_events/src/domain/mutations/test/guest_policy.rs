use super::*;
use crate::domain::models::CalendarProvider;

const ORGANIZER: &str = "olivia@example.com";

const NO_INVITES: GuestPolicy = GuestPolicy {
    can_modify: false,
    can_invite_others: false,
    can_see_other_guests: true,
};

/// The actor's own meeting, with one guest.
fn organizer_repo() -> FakeRepo {
    let mut organizer = echo_attendee("self@example.com", false);
    organizer.is_organizer = true;
    FakeRepo {
        mutation_target: Some(mutation_target(false)),
        stored_attendees: vec![organizer, echo_attendee("guest@example.com", false)],
        ..FakeRepo::default()
    }
}

/// Olivia's meeting, with the actor as a guest she lets modify it.
fn modifying_guest_repo() -> FakeRepo {
    let mut organizer = echo_attendee(ORGANIZER, false);
    organizer.is_organizer = true;
    FakeRepo {
        mutation_target: Some(CalendarEventMutationTarget {
            organizer_email: Some(ORGANIZER.to_string()),
            guest_policy: GuestPolicy {
                can_modify: true,
                can_invite_others: true,
                can_see_other_guests: true,
            },
            ..mutation_target(false)
        }),
        stored_attendees: vec![organizer, echo_attendee("self@example.com", false)],
        ..FakeRepo::default()
    }
}

/// The actor's own meeting on their Outlook calendar.
fn outlook_organizer_repo() -> FakeRepo {
    let mut repo = organizer_repo();
    let target = repo.mutation_target.as_mut().unwrap();
    target.token_identity.provider = CalendarProvider::Outlook;
    target.actor = ActorInboxes::from_owned(vec![OwnedInbox {
        link_id: SELF_LINK,
        email: "self@example.com".to_string(),
        provider: CalendarProvider::Outlook,
    }]);
    repo
}

fn policy_patch(guest_policy: GuestPolicy) -> CalendarEventPatch {
    CalendarEventPatch {
        guest_policy: Some(guest_policy),
        ..CalendarEventPatch::default()
    }
}

#[tokio::test]
async fn the_organizer_changes_the_guest_policy() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let patches = provider.updated_patches.clone();

    service(organizer_repo(), provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            policy_patch(NO_INVITES),
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();

    assert_eq!(
        patches.lock().unwrap().as_slice(),
        [policy_patch(NO_INVITES)]
    );
}

#[tokio::test]
async fn an_unchanged_guest_policy_is_not_sent() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let patches = provider.updated_patches.clone();

    service(organizer_repo(), provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            CalendarEventPatch {
                title: Some("Retro".to_string()),
                guest_policy: Some(GuestPolicy::default()),
                ..CalendarEventPatch::default()
            },
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();

    assert_eq!(
        patches.lock().unwrap().as_slice(),
        [CalendarEventPatch {
            title: Some("Retro".to_string()),
            ..CalendarEventPatch::default()
        }]
    );
}

#[tokio::test]
async fn a_guest_who_may_modify_still_cannot_change_the_guest_policy() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = service(modifying_guest_repo(), provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            policy_patch(NO_INVITES),
            CalendarUpdateScope::All,
        )
        .await
        .unwrap_err();

    assert!(
        matches!(error, CalendarMutationError::NotOrganizer),
        "{error:?}"
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_outlook_event_refuses_a_guest_policy_as_unsupported() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = service(outlook_organizer_repo(), provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            policy_patch(NO_INVITES),
            CalendarUpdateScope::All,
        )
        .await
        .unwrap_err();

    assert!(
        matches!(error, CalendarMutationError::ProviderRejected(_)),
        "{error:?}"
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_new_event_carries_a_guest_policy_only_when_it_departs_from_the_defaults() {
    for (requested, sent) in [
        (Some(NO_INVITES), Some(NO_INVITES)),
        (Some(GuestPolicy::default()), None),
        (None, None),
    ] {
        let provider = FakeProvider::new(FakeProviderBehavior::Echo);
        let drafts = provider.created_drafts.clone();

        service(
            FakeRepo {
                creation_target: Some(creation_target(false)),
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
                guest_policy: requested,
                ..draft()
            },
        )
        .await
        .unwrap();

        assert_eq!(
            drafts.lock().unwrap()[0].guest_policy,
            sent,
            "{requested:?}"
        );
    }
}

#[tokio::test]
async fn a_new_outlook_event_refuses_a_guest_policy() {
    let mut creation = creation_target(false);
    creation.token_identity.provider = CalendarProvider::Outlook;
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = service(
        FakeRepo {
            creation_target: Some(creation),
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
            guest_policy: Some(NO_INVITES),
            ..draft()
        },
    )
    .await
    .unwrap_err();

    assert!(
        matches!(error, CalendarMutationError::ProviderRejected(_)),
        "{error:?}"
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_guest_policy_change_to_one_occurrence_is_refused() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = service(organizer_repo(), provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            policy_patch(NO_INVITES),
            CalendarUpdateScope::ThisEvent {
                recurrence_id: "2026-08-06T14:00:00+00:00".to_string(),
            },
        )
        .await
        .unwrap_err();

    assert!(
        matches!(error, CalendarMutationError::InvalidInput(_)),
        "{error:?}"
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_out_of_office_event_refuses_a_guest_policy() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = service(
        FakeRepo {
            creation_target: Some(creation_target(false)),
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
            guest_policy: Some(NO_INVITES),
            ..out_of_office_draft()
        },
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, CalendarMutationError::InvalidInput(message) if message.contains("guests to set permissions")),
        "{error:?}"
    );
    assert!(calls.lock().unwrap().is_empty());
}
