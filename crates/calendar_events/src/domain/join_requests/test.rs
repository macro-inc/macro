use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::CalendarJoinRequestServiceImpl;
use crate::domain::{
    models::{CalendarEventCopyAccess, CalendarJoinRequest, CalendarJoinTarget},
    mutations::test::{FakeRepo, join_repo, owner_repo},
    ports::{CalendarJoinRequestError, CalendarJoinRequestNotifier, CalendarJoinRequestService},
};

#[derive(Clone, Default)]
struct RecordingNotifier {
    notified: Arc<Mutex<Vec<(String, Uuid, String)>>>,
}

impl CalendarJoinRequestNotifier for RecordingNotifier {
    async fn notify_join_request(
        &self,
        owner_id: &str,
        request: &CalendarJoinRequest,
        event_title: &str,
    ) {
        self.notified.lock().unwrap().push((
            owner_id.to_string(),
            request.event_id,
            event_title.to_string(),
        ));
    }
}

fn target(access: CalendarEventCopyAccess) -> CalendarJoinTarget {
    CalendarJoinTarget {
        access,
        event_id: Uuid::now_v7(),
        owner_id: "macro|owner@example.com".to_string(),
        title: "Offsite".to_string(),
        owner_is_organizer: true,
        guests_can_invite_others: true,
        requester_inbox_email: Some("asker@work.example.com".to_string()),
    }
}

fn service(
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

#[tokio::test]
async fn a_channel_member_asks_the_owner_to_add_their_inbox() {
    let shared = target(CalendarEventCopyAccess::ChannelShared);
    let repo = join_repo(Some(shared.clone()), true);
    let opened = repo.opened_join_requests.clone();
    let (service, notifier) = service(repo);

    service
        .request_to_join("macro|asker@example.com", Uuid::now_v7())
        .await
        .unwrap();

    assert_eq!(
        opened.lock().unwrap().as_slice(),
        [(
            shared.event_id,
            "macro|asker@example.com".to_string(),
            "asker@work.example.com".to_string()
        )]
    );
    assert_eq!(
        notifier.notified.lock().unwrap().as_slice(),
        [(
            "macro|owner@example.com".to_string(),
            shared.event_id,
            "Offsite".to_string()
        )]
    );
}

#[tokio::test]
async fn a_requester_without_an_inbox_is_invited_at_their_account_address() {
    let repo = join_repo(
        Some(CalendarJoinTarget {
            requester_inbox_email: None,
            ..target(CalendarEventCopyAccess::ChannelShared)
        }),
        true,
    );
    let opened = repo.opened_join_requests.clone();
    let (service, _) = service(repo);

    service
        .request_to_join("macro|asker@example.com", Uuid::now_v7())
        .await
        .unwrap();

    assert_eq!(opened.lock().unwrap()[0].2, "asker@example.com");
}

#[tokio::test]
async fn asking_again_does_not_notify_the_owner_twice() {
    let repo = join_repo(Some(target(CalendarEventCopyAccess::ChannelShared)), false);
    let (service, notifier) = service(repo);

    service
        .request_to_join("macro|asker@example.com", Uuid::now_v7())
        .await
        .unwrap();

    assert!(notifier.notified.lock().unwrap().is_empty());
}

#[tokio::test]
async fn requests_are_refused_when_they_could_not_be_accepted() {
    let cases = [
        (None, "unseen"),
        (Some(target(CalendarEventCopyAccess::OwnCopy)), "own copy"),
        (
            Some(CalendarJoinTarget {
                owner_is_organizer: false,
                guests_can_invite_others: false,
                ..target(CalendarEventCopyAccess::ChannelShared)
            }),
            "guest owner who may not invite",
        ),
    ];
    for (join_target, case) in cases {
        let expect_own_copy = matches!(
            &join_target,
            Some(target) if target.access == CalendarEventCopyAccess::OwnCopy
        );
        let expect_not_found = join_target.is_none();
        let repo = join_repo(join_target, true);
        let opened = repo.opened_join_requests.clone();
        let (service, notifier) = service(repo);

        let error = service
            .request_to_join("macro|asker@example.com", Uuid::now_v7())
            .await
            .unwrap_err();

        match error {
            CalendarJoinRequestError::NotFound => assert!(expect_not_found, "{case}"),
            CalendarJoinRequestError::AlreadyOnCalendar => assert!(expect_own_copy, "{case}"),
            CalendarJoinRequestError::OrganizerOnly => {
                assert!(!expect_not_found && !expect_own_copy, "{case}")
            }
            CalendarJoinRequestError::Internal(report) => panic!("{case}: {report:?}"),
        }
        assert!(opened.lock().unwrap().is_empty(), "{case}");
        assert!(notifier.notified.lock().unwrap().is_empty(), "{case}");
    }
}

#[tokio::test]
async fn a_guest_owner_can_be_asked_when_the_organizer_lets_guests_invite() {
    let repo = join_repo(
        Some(CalendarJoinTarget {
            owner_is_organizer: false,
            ..target(CalendarEventCopyAccess::ChannelShared)
        }),
        true,
    );
    let (service, _) = service(repo);

    assert!(
        service
            .request_to_join("macro|asker@example.com", Uuid::now_v7())
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn only_someone_who_can_edit_the_event_lists_its_requests() {
    let (stranger, _) = service(FakeRepo::default());
    assert!(matches!(
        stranger
            .list_join_requests("macro|stranger@example.com", Uuid::now_v7())
            .await,
        Err(CalendarJoinRequestError::NotFound)
    ));

    let (owner, _) = service(owner_repo());
    assert!(
        owner
            .list_join_requests("macro|self@example.com", Uuid::now_v7())
            .await
            .is_ok()
    );
}
