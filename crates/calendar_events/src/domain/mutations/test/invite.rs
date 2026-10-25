use super::*;
use crate::domain::models::CalendarProvider;

const ORGANIZER: &str = "olivia@example.com";

fn guest(email: &str) -> CalendarAttendeeInput {
    CalendarAttendeeInput {
        email: email.to_string(),
        is_optional: false,
        response_status: None,
    }
}

/// A target where the actor (`self@example.com`) is a guest of Olivia's
/// meeting under `guest_policy`.
fn guest_target(guest_policy: GuestPolicy) -> CalendarEventMutationTarget {
    CalendarEventMutationTarget {
        organizer_email: Some(ORGANIZER.to_string()),
        guest_policy,
        ..mutation_target(false)
    }
}

fn meeting_attendees() -> Vec<CalendarAttendee> {
    let mut organizer = echo_attendee(ORGANIZER, false);
    organizer.is_organizer = true;
    vec![organizer, echo_attendee("self@example.com", false)]
}

fn guest_repo(guest_policy: GuestPolicy) -> FakeRepo {
    FakeRepo {
        mutation_target: Some(guest_target(guest_policy)),
        stored_attendees: meeting_attendees(),
        ..FakeRepo::default()
    }
}

const NO_INVITES: GuestPolicy = GuestPolicy {
    can_modify: false,
    can_invite_others: false,
    can_see_other_guests: true,
};

const HIDDEN_LIST: GuestPolicy = GuestPolicy {
    can_modify: false,
    can_invite_others: true,
    can_see_other_guests: false,
};

#[tokio::test]
async fn a_guest_who_may_invite_sends_only_new_guests_through_the_partial_patch() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let invited = provider.invited_guests.clone();

    service(
        guest_repo(GuestPolicy::default()),
        provider,
        FakeTokens::ok(),
    )
    .invite_guests(
        "macro|user",
        Uuid::now_v7(),
        None,
        vec![
            guest("ada@example.com"),
            guest("OLIVIA@example.com"),
            guest("ada@example.com"),
        ],
        CalendarUpdateScope::ThisEvent {
            recurrence_id: "2026-08-06T14:00:00+00:00".to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["invite:master-id:this:2026-08-06T14:00:00+00:00"]
    );
    assert_eq!(
        invited.lock().unwrap().as_slice(),
        [vec![guest("ada@example.com")]],
        "guests already on the event, and repeats, are not sent again"
    );
}

#[tokio::test]
async fn a_guest_the_organizer_does_not_let_invite_is_refused_before_the_provider() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = service(guest_repo(NO_INVITES), provider, FakeTokens::ok())
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            None,
            vec![guest("ada@example.com")],
            CalendarUpdateScope::All,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, CalendarMutationError::GuestsCannotInvite));
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn someone_neither_organizing_nor_invited_is_not_an_attendee() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let mut repo = guest_repo(GuestPolicy::default());
    repo.stored_attendees = vec![meeting_attendees().remove(0)];

    let error = service(repo, provider, FakeTokens::ok())
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            None,
            vec![guest("ada@example.com")],
            CalendarUpdateScope::All,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, CalendarMutationError::NotAttendee));
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_refusal_from_google_records_the_policy_it_reported() {
    let repo = guest_repo(GuestPolicy::default());
    let event_id = repo.mutation_target.as_ref().unwrap().event_id;
    let recorded = repo.recorded_guest_policies.clone();
    let refresh = RecordingRefreshNotifier::default();
    let notified = refresh.notified.clone();

    let error = service_with_refresh(
        repo,
        FakeProvider::new(FakeProviderBehavior::Forbidden(NO_INVITES)),
        FakeTokens::ok(),
        refresh,
    )
    .invite_guests(
        "macro|user",
        event_id,
        None,
        vec![guest("ada@example.com")],
        CalendarUpdateScope::All,
    )
    .await
    .unwrap_err();

    assert!(matches!(error, CalendarMutationError::GuestsCannotInvite));
    assert_eq!(
        recorded.lock().unwrap().as_slice(),
        [(event_id, NO_INVITES)]
    );
    assert_eq!(
        notified.lock().unwrap().len(),
        1,
        "viewers refetch so the invite control turns into the explanation"
    );
}

#[tokio::test]
async fn a_guest_cannot_add_to_a_guest_list_the_organizer_hides() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = service(guest_repo(HIDDEN_LIST), provider, FakeTokens::ok())
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            None,
            vec![guest("ada@example.com")],
            CalendarUpdateScope::All,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, CalendarMutationError::GuestListHidden));
    assert!(
        calls.lock().unwrap().is_empty(),
        "a full write from a copy of a hidden list would drop the guests it cannot see"
    );
}

#[tokio::test]
async fn a_hidden_list_google_reports_is_refused_and_recorded() {
    let repo = guest_repo(GuestPolicy::default());
    let event_id = repo.mutation_target.as_ref().unwrap().event_id;
    let recorded = repo.recorded_guest_policies.clone();

    let error = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::GuestListHidden(HIDDEN_LIST)),
        FakeTokens::ok(),
    )
    .invite_guests(
        "macro|user",
        event_id,
        None,
        vec![guest("ada@example.com")],
        CalendarUpdateScope::All,
    )
    .await
    .unwrap_err();

    assert!(matches!(error, CalendarMutationError::GuestListHidden));
    assert_eq!(
        recorded.lock().unwrap().as_slice(),
        [(event_id, HIDDEN_LIST)]
    );
}

#[tokio::test]
async fn the_organizer_may_add_to_a_hidden_guest_list() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let invited = provider.invited_guests.clone();
    let mut repo = guest_repo(HIDDEN_LIST);
    repo.mutation_target.as_mut().unwrap().organizer_email = Some("self@example.com".to_string());

    service(repo, provider, FakeTokens::ok())
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            None,
            vec![guest("ada@example.com")],
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();

    assert_eq!(
        invited.lock().unwrap().as_slice(),
        [vec![guest("ada@example.com")]]
    );
}

#[tokio::test]
async fn a_guests_update_adds_through_the_invite_path_and_keeps_its_other_fields() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let invited = provider.invited_guests.clone();
    let patches = provider.updated_patches.clone();

    service(
        guest_repo(GuestPolicy::default()),
        provider,
        FakeTokens::ok(),
    )
    .update_event(
        "macro|user",
        Uuid::now_v7(),
        None,
        CalendarEventPatch {
            transparency: Some(EventTransparency::Transparent),
            // The editor leaves the viewer's own row out of the list.
            attendees: Some(vec![guest(ORGANIZER), guest("ada@example.com")]),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    assert_eq!(
        calls.lock().unwrap().as_slice(),
        ["invite:master-id:all", "update:master-id"]
    );
    assert_eq!(
        invited.lock().unwrap().as_slice(),
        [vec![guest("ada@example.com")]]
    );
    let sent = patches.lock().unwrap();
    assert_eq!(
        sent[0].attendees, None,
        "the replacement list never reaches Google"
    );
    assert_eq!(sent[0].transparency, Some(EventTransparency::Transparent));
}

#[tokio::test]
async fn a_guest_cannot_remove_guests_through_an_update() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = service(
        guest_repo(GuestPolicy::default()),
        provider,
        FakeTokens::ok(),
    )
    .update_event(
        "macro|user",
        Uuid::now_v7(),
        None,
        CalendarEventPatch {
            attendees: Some(vec![guest("ada@example.com")]),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, CalendarMutationError::InvalidInput(message) if message == "guests can add guests but not remove them"),
        "{error:?}"
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_guest_who_may_modify_still_replaces_the_list() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    service(
        guest_repo(GuestPolicy {
            can_modify: true,
            can_invite_others: true,
            can_see_other_guests: true,
        }),
        provider,
        FakeTokens::ok(),
    )
    .update_event(
        "macro|user",
        Uuid::now_v7(),
        None,
        CalendarEventPatch {
            attendees: Some(vec![guest("ada@example.com")]),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    assert_eq!(calls.lock().unwrap().as_slice(), ["update:master-id"]);
}

#[tokio::test]
async fn an_occurrence_with_its_own_guest_list_is_judged_by_that_list() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let invited = provider.invited_guests.clone();
    let mut repo = guest_repo(GuestPolicy::default());
    // The series still lists Bo, but this occurrence dropped him.
    repo.stored_attendees
        .push(echo_attendee("bo@example.com", false));
    repo.occurrence_override_attendees = Some(meeting_attendees());

    service(repo, provider, FakeTokens::ok())
        .update_event(
            "macro|user",
            Uuid::now_v7(),
            None,
            CalendarEventPatch {
                attendees: Some(vec![guest(ORGANIZER), guest("bo@example.com")]),
                ..CalendarEventPatch::default()
            },
            CalendarUpdateScope::ThisEvent {
                recurrence_id: "2026-08-06T14:00:00+00:00".to_string(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        invited.lock().unwrap().as_slice(),
        [vec![guest("bo@example.com")]],
        "re-inviting Bo to this occurrence is an addition, not a no-op"
    );
}

const OTHER_LINK: Uuid = Uuid::from_u128(0x0e);

#[tokio::test]
async fn a_guest_copy_is_judged_as_its_own_inbox_while_another_inbox_organizes() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();
    let mut repo = guest_repo(NO_INVITES);
    // The actor also connected Olivia's inbox, which organizes the meeting.
    repo.mutation_target.as_mut().unwrap().actor = ActorInboxes::from_owned(vec![
        owned(SELF_LINK, "self@example.com"),
        owned(OTHER_LINK, ORGANIZER),
    ]);

    let error = service(repo, provider, FakeTokens::ok())
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            None,
            vec![guest("ada@example.com")],
            CalendarUpdateScope::All,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, CalendarMutationError::GuestsCannotInvite));
    assert!(
        calls.lock().unwrap().is_empty(),
        "this copy is written through the guest's grant, which the organizer's inbox does not lend rights to"
    );
}

#[tokio::test]
async fn the_provider_hears_only_the_copys_inbox() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let invited_as = provider.invited_as.clone();
    let mut repo = guest_repo(GuestPolicy::default());
    repo.mutation_target.as_mut().unwrap().actor = ActorInboxes::from_owned(vec![
        owned(SELF_LINK, "self@example.com"),
        owned(OTHER_LINK, ORGANIZER),
    ]);

    service(repo, provider, FakeTokens::ok())
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            None,
            vec![guest("ada@example.com")],
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();

    assert_eq!(
        invited_as.lock().unwrap().as_slice(),
        [vec!["self@example.com".to_string()]]
    );
}

fn outlook_repo(organizer: &str) -> FakeRepo {
    let mut repo = guest_repo(GuestPolicy::default());
    let target = repo.mutation_target.as_mut().unwrap();
    target.organizer_email = Some(organizer.to_string());
    target.token_identity.provider = CalendarProvider::Outlook;
    target.actor = ActorInboxes::from_owned(vec![OwnedInbox {
        link_id: SELF_LINK,
        email: "self@example.com".to_string(),
        provider: CalendarProvider::Outlook,
    }]);
    repo
}

#[tokio::test]
async fn an_outlook_guest_is_refused_before_the_provider() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let error = service(outlook_repo(ORGANIZER), provider, FakeTokens::ok())
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            None,
            vec![guest("ada@example.com")],
            CalendarUpdateScope::All,
        )
        .await
        .unwrap_err();

    assert!(
        matches!(error, CalendarMutationError::GuestsCannotInvite),
        "{error:?}"
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_outlook_organizer_adds_guests_through_the_provider() {
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let invited = provider.invited_guests.clone();

    service(outlook_repo("self@example.com"), provider, FakeTokens::ok())
        .invite_guests(
            "macro|user",
            Uuid::now_v7(),
            None,
            vec![guest("ada@example.com")],
            CalendarUpdateScope::All,
        )
        .await
        .unwrap();

    assert_eq!(
        invited.lock().unwrap().as_slice(),
        [vec![guest("ada@example.com")]]
    );
}
