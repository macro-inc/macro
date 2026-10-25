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

fn asking(
    repo: FakeRepo,
) -> (
    CalendarJoinRequestServiceImpl<FakeRepo, RecordingNotifier>,
    RecordingNotifier,
) {
    let notifier = RecordingNotifier::default();
    (
        CalendarJoinRequestServiceImpl::new(repo, notifier.clone()),
        notifier,
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
        [request.clone()]
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
