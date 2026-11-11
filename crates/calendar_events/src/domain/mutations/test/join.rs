//! Asking to join a channel-shared event and answering the request.
use super::*;
use crate::domain::ics::{CalendarEventExport, CalendarEventExportAccess};
use crate::domain::join_requests::{
    CalendarJoinRequest, CalendarJoinRequestServiceImpl, CalendarJoinRequestStatus,
    annotate_join_state,
};
use crate::domain::models::{
    CalendarMentionEvent, CalendarMentionPreview, CalendarMentionRequestItem,
    CalendarMentionViewerCopy, CalendarProvider,
};
use crate::domain::ports::{
    CalendarJoinRequestError, CalendarJoinRequestNotifier, CalendarJoinRequestService,
};

const SHARER: &str = "macro|self@example.com";
const MEMBER: &str = "macro|member@example.com";
const ORGANIZER: &str = "olivia@example.com";

#[derive(Clone, Default)]
struct RecordingNotifier {
    notified: Arc<Mutex<Vec<(String, Uuid, String)>>>,
}

impl CalendarJoinRequestNotifier for RecordingNotifier {
    async fn notify_join_request(
        &self,
        sharer_id: &str,
        request: &CalendarJoinRequest,
        event_title: &str,
    ) {
        self.notified.lock().unwrap().push((
            sharer_id.to_string(),
            request.id,
            event_title.to_string(),
        ));
    }
}

fn shared_export(access: CalendarEventExportAccess) -> CalendarEventExport {
    CalendarEventExport {
        access,
        owner_id: SHARER.to_string(),
        event_type: EventType::Default,
        ical_uid: "meeting@example.com".to_string(),
        sequence: 0,
        title: "Offsite".to_string(),
        description: None,
        location: None,
        time: timed_time(),
        recurrence_lines: Vec::new(),
        organizer_email: Some(ORGANIZER.to_string()),
        organizer_name: None,
        updated_at: Utc::now(),
    }
}

/// The sharer's copy of Olivia's meeting, where they are a guest under
/// `guest_policy`.
fn sharer_as_guest(guest_policy: GuestPolicy) -> FakeRepo {
    let mut organizer = echo_attendee(ORGANIZER, false);
    organizer.is_organizer = true;
    FakeRepo {
        export: Some(shared_export(CalendarEventExportAccess::ChannelShared)),
        mutation_target: Some(CalendarEventMutationTarget {
            organizer_email: Some(ORGANIZER.to_string()),
            guest_policy,
            ..mutation_target(false)
        }),
        stored_attendees: vec![organizer, echo_attendee("self@example.com", false)],
        ..FakeRepo::default()
    }
}

/// The sharer organizes the shared meeting; the member's calendar is on the
/// inbox `creation_target` names.
fn sharer_organizes() -> FakeRepo {
    FakeRepo {
        export: Some(shared_export(CalendarEventExportAccess::ChannelShared)),
        mutation_target: Some(mutation_target(false)),
        creation_target: Some(creation_target(false)),
        ..FakeRepo::default()
    }
}

type TestJoinRequestService =
    CalendarJoinRequestServiceImpl<FakeRepo, RecordingNotifier, RecordingRefreshNotifier>;

fn asking(repo: FakeRepo) -> (TestJoinRequestService, RecordingNotifier) {
    let (service, notifier, _) = asking_with_refresh(repo);
    (service, notifier)
}

/// The service with a refresh notifier that watches `repo`'s stored requests.
fn asking_with_refresh(
    repo: FakeRepo,
) -> (
    TestJoinRequestService,
    RecordingNotifier,
    RecordingRefreshNotifier,
) {
    let notifier = RecordingNotifier::default();
    let refresh = RecordingRefreshNotifier {
        join_requests: repo.join_requests.clone(),
        ..RecordingRefreshNotifier::default()
    };
    (
        CalendarJoinRequestServiceImpl::new(repo, notifier.clone(), refresh.clone()),
        notifier,
        refresh,
    )
}

fn pending_request(repo: &FakeRepo, status: CalendarJoinRequestStatus) -> CalendarJoinRequest {
    let request = CalendarJoinRequest {
        id: Uuid::now_v7(),
        event_id: Uuid::now_v7(),
        requester_id: MEMBER.to_string(),
        requester_email: "member@example.com".to_string(),
        status,
        created_at: Utc::now(),
    };
    repo.join_requests.lock().unwrap().push(request.clone());
    request
}

#[tokio::test]
async fn a_channel_member_asks_the_sharer_only_once() {
    let repo = sharer_organizes();
    let requests = repo.join_requests.clone();
    let (service, notifier) = asking(repo);
    let event_id = Uuid::now_v7();

    let first = service.request_to_join(MEMBER, event_id).await.unwrap();
    // The calendar inbox an added copy would land on is the one invited.
    assert_eq!(first.requester_email, "self@example.com");
    assert_eq!(first.status, CalendarJoinRequestStatus::Pending);

    let again = service.request_to_join(MEMBER, event_id).await.unwrap();
    assert_eq!(again.id, first.id);
    assert_eq!(notifier.notified.lock().unwrap().len(), 1);

    // A declined request stands: asking again is refused and the sharer is
    // not asked a second time.
    requests.lock().unwrap()[0].status = CalendarJoinRequestStatus::Declined;
    let error = service.request_to_join(MEMBER, event_id).await.unwrap_err();
    assert!(
        matches!(error, CalendarJoinRequestError::Declined),
        "{error:?}"
    );
    assert_eq!(
        requests.lock().unwrap()[0].status,
        CalendarJoinRequestStatus::Declined
    );
    assert_eq!(
        notifier.notified.lock().unwrap().as_slice(),
        [(SHARER.to_string(), first.id, "Offsite".to_string())]
    );
}

#[tokio::test]
async fn a_new_request_refreshes_the_lists_readers_once_it_is_stored() {
    let (service, _, refresh) = asking_with_refresh(sharer_organizes());

    service
        .request_to_join(MEMBER, Uuid::now_v7())
        .await
        .unwrap();

    assert_eq!(
        refresh.notified.lock().unwrap().as_slice(),
        [(SHARER.to_string(), SELF_LINK, false)]
    );
    // The nudge saw the stored request, so a refetch finds it.
    assert_eq!(
        refresh.seen_statuses.lock().unwrap().as_slice(),
        [CalendarJoinRequestStatus::Pending]
    );
    // The requester reads no list and is told nothing about the sharer's inbox.
    assert!(refresh.answered_requesters.lock().unwrap().is_empty());
}

#[tokio::test]
async fn only_the_first_ask_refreshes_the_list() {
    for status in [
        CalendarJoinRequestStatus::Pending,
        CalendarJoinRequestStatus::Accepted,
        CalendarJoinRequestStatus::Declined,
    ] {
        let repo = sharer_organizes();
        let request = pending_request(&repo, status);
        let (service, _, refresh) = asking_with_refresh(repo);

        let result = service.request_to_join(MEMBER, request.event_id).await;

        assert_eq!(
            result.is_err(),
            status == CalendarJoinRequestStatus::Declined,
            "{status:?}"
        );
        assert!(refresh.notified.lock().unwrap().is_empty(), "{status:?}");
    }
}

#[tokio::test]
async fn a_refused_ask_refreshes_nothing() {
    let not_shared = FakeRepo {
        export: None,
        ..sharer_organizes()
    };
    let own_copy = FakeRepo {
        export: Some(shared_export(CalendarEventExportAccess::OwnCopy)),
        ..sharer_organizes()
    };
    let cannot_invite = sharer_as_guest(GuestPolicy {
        can_invite_others: false,
        ..GuestPolicy::default()
    });
    let read_only = FakeRepo {
        mutation_target: Some(mutation_target(true)),
        ..sharer_organizes()
    };
    for (repo, case) in [
        (not_shared, "not shared with the requester"),
        (own_copy, "already on the requester's calendar"),
        (cannot_invite, "the sharer may not add guests"),
        (read_only, "the sharer's calendar is read-only"),
    ] {
        let (service, _, refresh) = asking_with_refresh(repo);

        assert!(
            service
                .request_to_join(MEMBER, Uuid::now_v7())
                .await
                .is_err(),
            "{case}"
        );
        assert!(refresh.notified.lock().unwrap().is_empty(), "{case}");
    }
}

#[tokio::test]
async fn a_member_without_a_calendar_is_invited_at_their_account_address() {
    let (service, _) = asking(FakeRepo {
        creation_target: None,
        ..sharer_organizes()
    });

    let request = service
        .request_to_join(MEMBER, Uuid::now_v7())
        .await
        .unwrap();

    assert_eq!(request.requester_email, "member@example.com");
}

#[tokio::test]
async fn asking_is_refused_when_the_sharer_could_not_accept() {
    let no_invites = GuestPolicy {
        can_invite_others: false,
        ..GuestPolicy::default()
    };
    let hidden_list = GuestPolicy {
        can_see_other_guests: false,
        ..GuestPolicy::default()
    };
    let read_only = FakeRepo {
        mutation_target: Some(mutation_target(true)),
        ..sharer_organizes()
    };
    let snapshot = FakeRepo {
        mutation_target: Some(CalendarEventMutationTarget {
            is_snapshot: true,
            ..mutation_target(false)
        }),
        ..sharer_organizes()
    };
    for (repo, case) in [
        (sharer_as_guest(no_invites), "organizer disallows inviting"),
        (
            sharer_as_guest(hidden_list),
            "organizer hides the guest list",
        ),
        (read_only, "the sharer's calendar is read-only"),
        (snapshot, "the sharer holds only a snapshot"),
    ] {
        let requests = repo.join_requests.clone();
        let (service, notifier) = asking(repo);

        let error = service
            .request_to_join(MEMBER, Uuid::now_v7())
            .await
            .unwrap_err();

        assert!(
            matches!(error, CalendarJoinRequestError::SharerCannotInvite),
            "{case}"
        );
        assert!(requests.lock().unwrap().is_empty(), "{case}");
        assert!(notifier.notified.lock().unwrap().is_empty(), "{case}");
    }

    // A guest the organizer lets invite, with the list visible, may accept.
    let (service, _) = asking(sharer_as_guest(GuestPolicy::default()));
    assert!(
        service
            .request_to_join(MEMBER, Uuid::now_v7())
            .await
            .is_ok()
    );
}

/// `repo` with the sharer's copy synced through an Outlook inbox.
fn on_outlook(mut repo: FakeRepo) -> FakeRepo {
    let target = repo.mutation_target.as_mut().unwrap();
    target.token_identity.provider = CalendarProvider::Outlook;
    target.actor = ActorInboxes::from_owned(vec![OwnedInbox {
        link_id: SELF_LINK,
        email: "self@example.com".to_string(),
        provider: CalendarProvider::Outlook,
        writable_calendar_ids: Vec::new(),
    }]);
    repo
}

#[tokio::test]
async fn an_outlook_sharer_can_be_asked_only_as_the_organizer() {
    // Outlook guests may only answer, whatever the organizer's policy says.
    let repo = on_outlook(sharer_as_guest(GuestPolicy::default()));
    let requests = repo.join_requests.clone();
    let (service, notifier) = asking(repo);

    let error = service
        .request_to_join(MEMBER, Uuid::now_v7())
        .await
        .unwrap_err();

    assert!(
        matches!(error, CalendarJoinRequestError::SharerCannotInvite),
        "{error:?}"
    );
    assert!(requests.lock().unwrap().is_empty());
    assert!(notifier.notified.lock().unwrap().is_empty());

    let mut organizer = echo_attendee("self@example.com", true);
    organizer.is_organizer = true;
    let (service, _) = asking(on_outlook(FakeRepo {
        stored_attendees: vec![organizer, echo_attendee("ada@example.com", false)],
        ..sharer_organizes()
    }));
    assert!(
        service
            .request_to_join(MEMBER, Uuid::now_v7())
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn asking_needs_a_channel_share_and_no_copy_of_your_own() {
    let (service, _) = asking(FakeRepo {
        export: Some(shared_export(CalendarEventExportAccess::OwnCopy)),
        ..sharer_organizes()
    });
    assert!(matches!(
        service.request_to_join(MEMBER, Uuid::now_v7()).await,
        Err(CalendarJoinRequestError::AlreadyOnCalendar)
    ));

    let (service, _) = asking(FakeRepo {
        export: None,
        ..sharer_organizes()
    });
    assert!(matches!(
        service.request_to_join(MEMBER, Uuid::now_v7()).await,
        Err(CalendarJoinRequestError::NotFound)
    ));
}

#[tokio::test]
async fn only_someone_who_can_change_the_event_lists_its_requests() {
    let repo = sharer_organizes();
    let request = pending_request(&repo, CalendarJoinRequestStatus::Pending);
    let (service, _) = asking(repo);
    assert_eq!(
        service
            .list_join_requests(SHARER, request.event_id)
            .await
            .unwrap(),
        std::slice::from_ref(&request)
    );

    for (mutation_target, case) in [
        (None, "no copy of the event"),
        (Some(mutation_target(true)), "a read-only copy"),
    ] {
        let (service, _) = asking(FakeRepo {
            mutation_target,
            ..sharer_organizes()
        });
        assert!(
            matches!(
                service.list_join_requests(MEMBER, request.event_id).await,
                Err(CalendarJoinRequestError::NotFound)
            ),
            "{case}"
        );
    }
}

#[tokio::test]
async fn accepting_invites_the_requester_through_the_invite_path() {
    let repo = sharer_organizes();
    let request = pending_request(&repo, CalendarJoinRequestStatus::Pending);
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let invited = provider.invited_guests.clone();

    let answered = service(repo, provider, FakeTokens::ok())
        .respond_to_join_request(SHARER, request.id, true)
        .await
        .unwrap();

    assert_eq!(answered.status, CalendarJoinRequestStatus::Accepted);
    assert_eq!(
        invited.lock().unwrap().as_slice(),
        [vec![CalendarAttendeeInput {
            email: "member@example.com".to_string(),
            is_optional: false,
            response_status: None,
        }]]
    );
}

#[tokio::test]
async fn declining_only_records_the_answer() {
    let repo = sharer_organizes();
    let request = pending_request(&repo, CalendarJoinRequestStatus::Pending);
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let answered = service(repo, provider, FakeTokens::ok())
        .respond_to_join_request(SHARER, request.id, false)
        .await
        .unwrap();

    assert_eq!(answered.status, CalendarJoinRequestStatus::Declined);
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn answering_a_resolved_request_returns_it_unchanged() {
    let repo = sharer_organizes();
    let request = pending_request(&repo, CalendarJoinRequestStatus::Declined);
    let provider = FakeProvider::new(FakeProviderBehavior::Echo);
    let calls = provider.calls.clone();

    let answered = service(repo, provider, FakeTokens::ok())
        .respond_to_join_request(SHARER, request.id, true)
        .await
        .unwrap();

    assert_eq!(answered, request);
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_answer_refreshes_the_list_and_the_requesters_card() {
    for (accept, status) in [
        (true, CalendarJoinRequestStatus::Accepted),
        (false, CalendarJoinRequestStatus::Declined),
    ] {
        let repo = sharer_organizes();
        let request = pending_request(&repo, CalendarJoinRequestStatus::Pending);
        let refresh = RecordingRefreshNotifier {
            join_requests: repo.join_requests.clone(),
            ..RecordingRefreshNotifier::default()
        };

        service_with_refresh(
            repo,
            FakeProvider::new(FakeProviderBehavior::Echo),
            FakeTokens::ok(),
            refresh.clone(),
        )
        .respond_to_join_request(SHARER, request.id, accept)
        .await
        .unwrap();

        // A decline writes nothing to the provider, so nothing else would
        // tell the list's readers; the last nudge carries the stored answer
        // even when an acceptance's invite nudged earlier.
        assert_eq!(
            refresh.notified.lock().unwrap().last(),
            Some(&(SHARER.to_string(), SELF_LINK, false)),
            "accept={accept}"
        );
        assert_eq!(
            refresh.seen_statuses.lock().unwrap().last(),
            Some(&status),
            "accept={accept}"
        );
        assert_eq!(
            refresh.answered_requesters.lock().unwrap().as_slice(),
            [(MEMBER.to_string(), request.event_id)],
            "accept={accept}"
        );
    }
}

#[tokio::test]
async fn a_stale_answer_changes_nothing_so_it_refreshes_nothing() {
    for status in [
        CalendarJoinRequestStatus::Accepted,
        CalendarJoinRequestStatus::Declined,
    ] {
        for accept in [true, false] {
            let repo = sharer_organizes();
            let request = pending_request(&repo, status);
            let refresh = RecordingRefreshNotifier::default();

            let answered = service_with_refresh(
                repo,
                FakeProvider::new(FakeProviderBehavior::Echo),
                FakeTokens::ok(),
                refresh.clone(),
            )
            .respond_to_join_request(SHARER, request.id, accept)
            .await
            .unwrap();

            assert_eq!(answered, request, "{status:?} accept={accept}");
            assert!(refresh.notified.lock().unwrap().is_empty());
            assert!(refresh.answered_requesters.lock().unwrap().is_empty());
        }
    }
}

#[tokio::test]
async fn a_refused_invite_leaves_the_request_pending() {
    let repo = sharer_organizes();
    let request = pending_request(&repo, CalendarJoinRequestStatus::Pending);
    let requests = repo.join_requests.clone();

    let error = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::Forbidden(GuestPolicy {
            can_invite_others: false,
            ..GuestPolicy::default()
        })),
        FakeTokens::ok(),
    )
    .respond_to_join_request(SHARER, request.id, true)
    .await
    .unwrap_err();

    assert!(matches!(error, CalendarMutationError::GuestsCannotInvite));
    assert_eq!(
        requests.lock().unwrap()[0].status,
        CalendarJoinRequestStatus::Pending
    );
}

#[tokio::test]
async fn someone_who_cannot_change_the_event_cannot_answer() {
    let repo = FakeRepo {
        mutation_target: None,
        ..sharer_organizes()
    };
    let request = pending_request(&repo, CalendarJoinRequestStatus::Pending);
    let requests = repo.join_requests.clone();

    let error = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
    )
    .respond_to_join_request(MEMBER, request.id, false)
    .await
    .unwrap_err();

    assert!(matches!(error, CalendarMutationError::NotFound));
    assert_eq!(
        requests.lock().unwrap()[0].status,
        CalendarJoinRequestStatus::Pending
    );
}

#[tokio::test]
async fn a_read_only_copy_cannot_answer() {
    for accept in [true, false] {
        let repo = FakeRepo {
            mutation_target: Some(mutation_target(true)),
            ..sharer_organizes()
        };
        let request = pending_request(&repo, CalendarJoinRequestStatus::Pending);
        let requests = repo.join_requests.clone();
        let provider = FakeProvider::new(FakeProviderBehavior::Echo);
        let calls = provider.calls.clone();

        let error = service(repo, provider, FakeTokens::ok())
            .respond_to_join_request(SHARER, request.id, accept)
            .await
            .unwrap_err();

        assert!(
            matches!(error, CalendarMutationError::ReadOnly),
            "accept={accept}: {error:?}"
        );
        assert!(calls.lock().unwrap().is_empty(), "accept={accept}");
        assert_eq!(
            requests.lock().unwrap()[0].status,
            CalendarJoinRequestStatus::Pending,
            "accept={accept}"
        );
    }
}

fn preview(viewer_event_id: Option<Uuid>) -> CalendarMentionPreview {
    CalendarMentionPreview::Accessible(Box::new(CalendarMentionEvent {
        viewer_copy: viewer_event_id.map(|_| CalendarMentionViewerCopy::Event),
        viewer_calendar_ids: Vec::new(),
        viewer_event_id,
        title: "Offsite".to_string(),
        description: None,
        time: timed_time(),
        occurrence_key: None,
        is_recurring: false,
        location: None,
        organizer_email: Some(ORGANIZER.to_string()),
        organizer_name: None,
        attendee_count: 2,
        updated_at: Utc::now(),
        can_request_to_join: false,
        join_request_status: None,
    }))
}

#[tokio::test]
async fn channel_shared_previews_carry_the_ask_to_join_state() {
    let repo = sharer_organizes();
    let request = pending_request(&repo, CalendarJoinRequestStatus::Pending);
    let items = [
        CalendarMentionRequestItem {
            event_id: request.event_id,
            occurrence_key: None,
        },
        CalendarMentionRequestItem {
            event_id: Uuid::now_v7(),
            occurrence_key: None,
        },
    ];
    let mut previews = vec![preview(None), preview(Some(Uuid::now_v7()))];

    annotate_join_state(&repo, MEMBER, &items, &mut previews)
        .await
        .unwrap();

    let CalendarMentionPreview::Accessible(shared) = &previews[0] else {
        panic!("the shared preview stays accessible");
    };
    assert!(shared.can_request_to_join);
    assert_eq!(
        shared.join_request_status,
        Some(CalendarJoinRequestStatus::Pending)
    );
    // The requester's own copy is left alone.
    let CalendarMentionPreview::Accessible(own) = &previews[1] else {
        panic!("the own preview stays accessible");
    };
    assert!(!own.can_request_to_join);
    assert_eq!(own.join_request_status, None);
}

#[tokio::test]
async fn a_declined_requester_may_not_ask_again() {
    let repo = sharer_organizes();
    let request = pending_request(&repo, CalendarJoinRequestStatus::Declined);
    let items = [CalendarMentionRequestItem {
        event_id: request.event_id,
        occurrence_key: None,
    }];
    let mut previews = vec![preview(None)];

    annotate_join_state(&repo, MEMBER, &items, &mut previews)
        .await
        .unwrap();

    let CalendarMentionPreview::Accessible(shared) = &previews[0] else {
        panic!("the shared preview stays accessible");
    };
    assert!(!shared.can_request_to_join);
    assert_eq!(
        shared.join_request_status,
        Some(CalendarJoinRequestStatus::Declined)
    );
}
