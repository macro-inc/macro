use super::*;
use crate::domain::models::AloneCallState;
use crate::domain::service::alone::{ALONE_END_GRACE, ALONE_WARNING_AFTER};

const ALONE_CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5d001);
const ALONE_CHANNEL_ID: Uuid = Uuid::from_u128(0x3f6f8b0a_6f9f_4a3f_9c3a_2b1e5d4c7d01);
const ALONE_GUEST_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5d002);
const ALONE_USER: &str = "alone@example.com";
const COMPANION: &str = "companion@example.com";

fn alone_call() -> Call {
    Call {
        id: ALONE_CALL_ID,
        channel_id: Some(ALONE_CHANNEL_ID),
        room_name: ALONE_CALL_ID.to_string(),
        created_by: user(ALONE_USER).as_ref().to_string(),
        created_at: minutes_ago(30),
        egress_id: None,
    }
}

fn alone_state(alone_since: DateTime<Utc>, warned_at: Option<DateTime<Utc>>) -> AloneCallState {
    AloneCallState {
        alone_since,
        warned_at,
        newly_alone: false,
    }
}

/// One active call with no stale participation to reconcile; it never
/// empties out on its own.
fn sweep_repo() -> MockCallRepository {
    let mut repo = MockCallRepository::new();
    repo.expect_list_active_calls()
        .times(1)
        .returning(|| Box::pin(async { Ok(vec![alone_call()]) }));
    repo.expect_get_participants()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    repo.expect_get_active_guests()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    repo.expect_get_participant_count()
        .returning(|_| Box::pin(async { Ok(1) }));
    repo
}

/// The call's room has exactly `identities` connected.
fn sweep_rtc(identities: &[&str]) -> MockCallRtcClient {
    let identities: Vec<String> = identities.iter().map(ToString::to_string).collect();
    let mut rtc_client = MockCallRtcClient::new();
    rtc_client
        .expect_list_participant_identities()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(Some(identities)) }));
    rtc_client
        .expect_list_rooms()
        .returning(|| Box::pin(async { Ok(Vec::new()) }));
    rtc_client
}

async fn sweep(
    repo: MockCallRepository,
    rtc_client: MockCallRtcClient,
) -> (RecordingConnectionService, RecordingEventBroker) {
    let connection_service = RecordingConnectionService::default();
    let event_broker = RecordingEventBroker::default();
    build_webhook_service_with_connection(
        repo,
        rtc_client,
        connection_service.clone(),
        event_broker.clone(),
    )
    .reconcile_stale_calls()
    .await
    .expect("reconciliation succeeds");
    (connection_service, event_broker)
}

fn assert_warning(messages: &[SentChannelMessage], ends_at: DateTime<Utc>) {
    let [message] = messages else {
        panic!("expected exactly one alone warning")
    };
    assert_eq!(message.message_type, "call_alone_warning");
    assert_eq!(message.users, vec![user(ALONE_USER).as_ref().to_string()]);
    assert_eq!(
        message.message,
        json!({
            "channel_id": ALONE_CHANNEL_ID,
            "call_id": ALONE_CALL_ID,
            "ends_at": ends_at,
        })
    );
}

#[tokio::test]
async fn a_lone_user_starts_the_alone_period_without_a_warning() {
    let mut repo = sweep_repo();
    repo.expect_mark_call_alone()
        .withf(|call_id, _| *call_id == ALONE_CALL_ID)
        .times(1)
        .returning(|_, now| {
            Box::pin(async move {
                Ok(Some(AloneCallState {
                    alone_since: now,
                    warned_at: None,
                    newly_alone: true,
                }))
            })
        });
    repo.expect_warn_alone_call().never();
    repo.expect_clear_call_alone().never();

    // The transcription agent does not count as company.
    let (connection_service, _) = sweep(
        repo,
        sweep_rtc(&[user(ALONE_USER).as_ref(), "agent-transcriber"]),
    )
    .await;

    assert!(connection_service.messages().is_empty());
}

#[tokio::test]
async fn a_user_alone_past_the_warning_period_is_warned_with_the_deadline() {
    let warned_at = DateTime::parse_from_rfc3339("2026-10-21T21:00:00Z")
        .expect("valid timestamp")
        .with_timezone(&Utc);
    let mut repo = sweep_repo();
    repo.expect_mark_call_alone()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(Some(alone_state(minutes_ago(6), None))) }));
    repo.expect_warn_alone_call()
        .withf(|call_id, now, alone_by| {
            *call_id == ALONE_CALL_ID && *now - *alone_by == ALONE_WARNING_AFTER
        })
        .times(1)
        .returning(move |_, _, _| Box::pin(async move { Ok(Some(warned_at)) }));

    let (connection_service, _) = sweep(repo, sweep_rtc(&[user(ALONE_USER).as_ref()])).await;

    assert_warning(&connection_service.messages(), warned_at + ALONE_END_GRACE);
    assert_eq!(
        connection_service.messages()[0].message["ends_at"],
        "2026-10-21T21:02:00Z"
    );
}

#[tokio::test]
async fn a_sweep_that_loses_the_warning_race_sends_nothing() {
    let mut repo = sweep_repo();
    repo.expect_mark_call_alone()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(Some(alone_state(minutes_ago(6), None))) }));
    // Another instance recorded the warning first.
    repo.expect_warn_alone_call()
        .times(1)
        .returning(|_, _, _| Box::pin(async { Ok(None) }));

    let (connection_service, _) = sweep(repo, sweep_rtc(&[user(ALONE_USER).as_ref()])).await;

    assert!(connection_service.messages().is_empty());
}

#[tokio::test]
async fn a_user_alone_under_the_warning_period_is_not_warned_yet() {
    let mut repo = sweep_repo();
    repo.expect_mark_call_alone()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(Some(alone_state(minutes_ago(4), None))) }));
    repo.expect_warn_alone_call().never();

    let (connection_service, _) = sweep(repo, sweep_rtc(&[user(ALONE_USER).as_ref()])).await;

    assert!(connection_service.messages().is_empty());
}

#[tokio::test]
async fn a_warned_user_is_re_sent_the_same_deadline_every_sweep() {
    let warned_at = minutes_ago(1);
    let mut repo = sweep_repo();
    repo.expect_mark_call_alone()
        .times(1)
        .returning(move |_, _| {
            Box::pin(async move { Ok(Some(alone_state(minutes_ago(6), Some(warned_at)))) })
        });
    repo.expect_warn_alone_call().never();
    repo.expect_archive_alone_call().never();

    let (connection_service, _) = sweep(repo, sweep_rtc(&[user(ALONE_USER).as_ref()])).await;

    assert_warning(&connection_service.messages(), warned_at + ALONE_END_GRACE);
}

#[tokio::test]
async fn a_warned_user_who_does_not_stay_is_removed_and_the_call_ended() {
    let mut repo = MockCallRepository::new();
    repo.expect_list_active_calls()
        .times(1)
        .returning(|| Box::pin(async { Ok(vec![alone_call()]) }));
    repo.expect_get_participants()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    repo.expect_get_active_guests()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    repo.expect_mark_call_alone().times(1).returning(|_, _| {
        Box::pin(async { Ok(Some(alone_state(minutes_ago(9), Some(minutes_ago(3))))) })
    });
    repo.expect_archive_alone_call()
        .withf(|call_id, warned_by| {
            *call_id == ALONE_CALL_ID && Utc::now() - *warned_by >= ALONE_END_GRACE
        })
        .times(1)
        .returning(|_, _| {
            Box::pin(async {
                Ok(Some(ArchivedCall {
                    call_id: ALONE_CALL_ID,
                    channel_id: Some(ALONE_CHANNEL_ID),
                    created_by: user(ALONE_USER).as_ref().to_string(),
                    started_at: minutes_ago(30),
                    ended_at: Utc::now(),
                    duration_ms: 1_800_000,
                    has_recording: false,
                    participants: vec![user(ALONE_USER).as_ref().to_string()],
                }))
            })
        });
    // The ended call is not checked for emptiness again.
    repo.expect_get_participant_count().never();

    let mut rtc_client = sweep_rtc(&[user(ALONE_USER).as_ref()]);
    rtc_client
        .expect_remove_participant()
        .withf(|room_name, identity| {
            room_name == ALONE_CALL_ID.to_string() && identity.as_ref() == user(ALONE_USER).as_ref()
        })
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    rtc_client
        .expect_delete_room()
        .withf(|room_name| room_name == ALONE_CALL_ID.to_string())
        .returning(|_| Box::pin(async { Ok(()) }));

    let (_, event_broker) = sweep(repo, rtc_client).await;

    let events = event_broker.events();
    let [archived] = events.as_slice() else {
        panic!("expected exactly one call event")
    };
    assert_eq!(archived.envelope["event_type"], "call.record_archived");
    assert_eq!(
        archived.envelope["metadata"]["archive_reason"],
        "alone_timeout"
    );
}

#[tokio::test]
async fn a_stay_that_wins_the_call_lock_keeps_the_call() {
    let mut repo = sweep_repo();
    repo.expect_mark_call_alone().times(1).returning(|_, _| {
        Box::pin(async { Ok(Some(alone_state(minutes_ago(9), Some(minutes_ago(3))))) })
    });
    repo.expect_archive_alone_call()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(None) }));
    let mut rtc_client = sweep_rtc(&[user(ALONE_USER).as_ref()]);
    rtc_client.expect_remove_participant().never();
    rtc_client.expect_delete_room().never();

    let (connection_service, event_broker) = sweep(repo, rtc_client).await;

    assert!(connection_service.messages().is_empty());
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn company_clears_a_sent_warning_for_everyone_present() {
    for cleared_warning in [true, false] {
        let mut repo = sweep_repo();
        repo.expect_clear_call_alone()
            .withf(|call_id| *call_id == ALONE_CALL_ID)
            .times(1)
            .returning(move |_| Box::pin(async move { Ok(cleared_warning) }));
        repo.expect_mark_call_alone().never();

        let (connection_service, _) = sweep(
            repo,
            sweep_rtc(&[user(ALONE_USER).as_ref(), user(COMPANION).as_ref()]),
        )
        .await;

        let messages = connection_service.messages();
        if !cleared_warning {
            assert!(messages.is_empty());
            continue;
        }
        let recipients: HashSet<Vec<String>> = messages
            .iter()
            .map(|message| message.users.clone())
            .collect();
        assert_eq!(
            recipients,
            HashSet::from([
                vec![user(ALONE_USER).as_ref().to_string()],
                vec![user(COMPANION).as_ref().to_string()],
            ])
        );
        for message in &messages {
            assert_eq!(message.message_type, "call_alone_cleared");
            assert_eq!(
                message.message,
                json!({ "channel_id": ALONE_CHANNEL_ID, "call_id": ALONE_CALL_ID })
            );
        }
    }
}

#[tokio::test]
async fn a_lone_guest_never_times_out() {
    let mut repo = sweep_repo();
    repo.expect_clear_call_alone()
        .times(1)
        .returning(|_| Box::pin(async { Ok(false) }));
    repo.expect_mark_call_alone().never();
    repo.expect_archive_alone_call().never();

    let guest_identity = GuestId::from_uuid(ALONE_GUEST_ID).to_string();
    let (connection_service, _) = sweep(repo, sweep_rtc(&[&guest_identity])).await;

    assert!(connection_service.messages().is_empty());
}

fn stay_service(
    repo: MockCallRepository,
    connection_service: RecordingConnectionService,
) -> impl CallService {
    build_webhook_service_with_connection(
        repo,
        MockCallRtcClient::new(),
        connection_service,
        RecordingEventBroker::default(),
    )
}

#[tokio::test]
async fn staying_restarts_the_alone_period_and_dismisses_the_warning_everywhere() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_id()
        .withf(|call_id| *call_id == ALONE_CALL_ID)
        .times(1)
        .returning(|_| Box::pin(async { Ok(Some(alone_call())) }));
    repo.expect_reset_call_alone()
        .withf(|call_id, user_id, _| {
            *call_id == ALONE_CALL_ID && user_id.as_ref() == user(ALONE_USER).as_ref()
        })
        .times(1)
        .returning(|_, _, _| Box::pin(async { Ok(true) }));
    let connection_service = RecordingConnectionService::default();

    stay_service(repo, connection_service.clone())
        .stay_in_call(&ALONE_CALL_ID, user(ALONE_USER))
        .await
        .expect("an active participant can stay");

    let messages = connection_service.messages();
    let [message] = messages.as_slice() else {
        panic!("expected exactly one alone-cleared message")
    };
    assert_eq!(message.message_type, "call_alone_cleared");
    assert_eq!(message.users, vec![user(ALONE_USER).as_ref().to_string()]);
    assert_eq!(
        message.message,
        json!({ "channel_id": ALONE_CHANNEL_ID, "call_id": ALONE_CALL_ID })
    );
}

#[tokio::test]
async fn staying_requires_a_live_call_the_user_is_in() {
    for live in [false, true] {
        let mut repo = MockCallRepository::new();
        repo.expect_get_call_by_id()
            .times(1)
            .returning(move |_| Box::pin(async move { Ok(live.then(alone_call)) }));
        // The user is not an active participant of the live call.
        repo.expect_reset_call_alone()
            .times(usize::from(live))
            .returning(|_, _, _| Box::pin(async { Ok(false) }));
        let connection_service = RecordingConnectionService::default();

        let result = stay_service(repo, connection_service.clone())
            .stay_in_call(&ALONE_CALL_ID, user(COMPANION))
            .await;

        assert!(matches!(result, Err(CallError::NotFound(_))));
        assert!(connection_service.messages().is_empty());
    }
}
