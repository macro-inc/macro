use super::*;
use crate::domain::models::JoinCallRequest;
use crate::domain::ports::ProgrammaticCallGate;

struct DisabledProgrammaticCalls;

#[async_trait::async_trait]
impl ProgrammaticCallGate for DisabledProgrammaticCalls {
    async fn enabled_for(&self, _caller: MacroUserIdStr<'_>) -> bool {
        false
    }
}

#[tokio::test]
async fn programmatic_call_gate_is_read_for_the_caller() {
    let service = join_service(MockCallRepository::new(), MockRtcClient::new())
        .with_programmatic_call_gate(DisabledProgrammaticCalls);

    assert!(!service
        .programmatic_calls_enabled(user("requester@example.com"))
        .await);
}

fn join_service(
    repo: MockCallRepository,
    rtc: MockRtcClient,
) -> BaseGetOrCreateCallService<StubConnectionService> {
    CallServiceImpl::new(
        repo,
        rtc,
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://livekit.example.com",
    )
}

#[tokio::test]
async fn join_rejects_an_ended_call_without_creating_one() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_id()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_create_call().never();
    let service = join_service(repo, MockRtcClient::new());

    assert!(matches!(
        service
            .join_call(
                &STARTED_EVENT_CALL_ID,
                user("requester@example.com"),
                JoinCallRequest::default(),
                true
            )
            .await,
        Err(CallError::Ended)
    ));
}

#[tokio::test]
async fn join_refuses_viewers_without_participant_access() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_id()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Some(started_event_call(STARTED_EVENT_CREATOR))) }));
    repo.expect_can_join_call()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(false) }));
    repo.expect_add_participant().never();
    let service = join_service(repo, MockRtcClient::new());

    assert!(matches!(
        service
            .join_call(
                &STARTED_EVENT_CALL_ID,
                user("requester@example.com"),
                JoinCallRequest::default(),
                true
            )
            .await,
        Err(CallError::Forbidden(_))
    ));
}

#[tokio::test]
async fn join_preserves_another_call_by_default() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_id()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Some(started_event_call(STARTED_EVENT_CREATOR))) }));
    repo.expect_can_join_call()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(true) }));
    repo.expect_find_active_call_for_user()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Some((SWITCHED_FROM_CALL_ID, None))) }));
    repo.expect_remove_participant().never();
    let service = join_service(repo, MockRtcClient::new());

    assert!(matches!(
        service
            .join_call(
                &STARTED_EVENT_CALL_ID,
                user("requester@example.com"),
                JoinCallRequest::default(),
                true
            )
            .await,
        Err(CallError::InOtherCall)
    ));
}

#[tokio::test]
async fn join_refuses_to_replace_an_existing_connection_by_default() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_id()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Some(started_event_call(STARTED_EVENT_CREATOR))) }));
    repo.expect_can_join_call()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(true) }));
    repo.expect_find_active_call_for_user()
        .times(1)
        .returning(|_| {
            Box::pin(async {
                Ok(Some((
                    STARTED_EVENT_CALL_ID,
                    Some(STARTED_EVENT_CHANNEL_ID),
                )))
            })
        });
    repo.expect_add_participant().never();
    let rtc = MockRtcClient::new().with_room(
        &STARTED_EVENT_CHANNEL_ID.to_string(),
        &[user("requester@example.com").as_ref()],
    );
    let service = join_service(repo, rtc);

    assert!(matches!(
        service
            .join_call(
                &STARTED_EVENT_CALL_ID,
                user("requester@example.com"),
                JoinCallRequest::default(),
                true
            )
            .await,
        Err(CallError::AlreadyConnected)
    ));
}

#[tokio::test]
async fn occupied_call_checks_program_only_expiry_before_staying_open() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_participant_count()
        .times(1)
        .returning(|_| Box::pin(async { Ok(1) }));
    repo.expect_archive_call_if_program_only()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_archive_call_if_empty().never();
    let service = join_service(repo, MockRtcClient::new());

    assert!(
        !service
            .finish_empty_call(&started_event_call(STARTED_EVENT_CREATOR))
            .await
            .unwrap()
    );
}
