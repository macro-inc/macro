use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use connection::domain::models::{ConnectionError, InvalidationEvent};
use connection::domain::ports::ConnectionService;
use entity_access::domain::ports::NoOpEntityAccessService;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::apple::VoipPushPayload;
use notification::domain::service::NotificationIngress;
use serde_json::json;
use uuid::Uuid;

use crate::domain::models::{
    ArchivedCall, Call, CallError, CallParticipant, CallWebhookEvent, EgressS3Config, RingStatus,
    VerifiedRingToken, VoipPushPayloadRequest,
};
use crate::domain::ports::{CallRtcClient, CallService, MockCallRepository, MockCallRtcClient};

use super::{
    CallServiceImpl, NoopCallSummarizer, derive_preview_key_from_recording_key,
    derive_preview_keys_from_recording_key, exclude_voip_recipients, extract_recording_key,
    resolve_ring_status,
};

#[cfg(feature = "outbound")]
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn user(email: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

struct MockRtcClient {
    tokens: Mutex<HashMap<String, anyhow::Result<String>>>,
    generate_calls: Mutex<Vec<(String, String)>>,
}

impl MockRtcClient {
    fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
            generate_calls: Mutex::new(Vec::new()),
        }
    }

    fn set_token(&self, identity: &str, token: anyhow::Result<String>) {
        self.tokens
            .lock()
            .unwrap()
            .insert(identity.to_string(), token);
    }

    fn calls(&self) -> Vec<(String, String)> {
        self.generate_calls.lock().unwrap().clone()
    }
}

impl CallRtcClient for MockRtcClient {
    async fn create_room(&self, _room_name: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn delete_room(&self, _room_name: &str) -> anyhow::Result<()> {
        unreachable!("delete_room not exercised by these tests")
    }

    async fn generate_token<'a>(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'a>,
    ) -> anyhow::Result<String> {
        let key = participant_identity.as_ref().to_string();
        self.generate_calls
            .lock()
            .unwrap()
            .push((room_name.to_string(), key.clone()));
        let mut tokens = self.tokens.lock().unwrap();
        tokens
            .remove(&key)
            .unwrap_or_else(|| Ok(format!("default-token-{key}")))
    }

    async fn build_voip_push_payloads<'a>(
        &self,
        request: VoipPushPayloadRequest<'a>,
    ) -> Vec<(MacroUserIdStr<'static>, VoipPushPayload)> {
        let mut payloads = Vec::new();
        for recipient_id in request.recipients {
            let livekit_token = match self
                .generate_token(request.room_name, recipient_id.clone())
                .await
            {
                Ok(livekit_token) => livekit_token,
                Err(_) => continue,
            };
            payloads.push((
                recipient_id.clone(),
                VoipPushPayload {
                    aps: Default::default(),
                    call_id: request.call_id.to_string(),
                    channel_id: request.channel_id.to_string(),
                    channel_name: request.channel_name.to_string(),
                    caller_name: request.caller_name.to_string(),
                    livekit_server_url: Some(request.livekit_server_url.to_string()),
                    livekit_token: Some(livekit_token),
                    ring_status_url: request.ring_status_url.map(str::to_string),
                },
            ));
        }

        payloads
    }

    async fn remove_participant<'a>(
        &self,
        _room_name: &str,
        _participant_identity: MacroUserIdStr<'a>,
    ) -> anyhow::Result<()> {
        unreachable!("remove_participant not exercised by these tests")
    }

    async fn start_room_composite_egress(
        &self,
        _room_name: &str,
        _s3_config: &EgressS3Config,
    ) -> anyhow::Result<String> {
        Ok("egress-id".to_string())
    }

    async fn stop_egress(&self, _egress_id: &str) -> anyhow::Result<()> {
        unreachable!("stop_egress not exercised by these tests")
    }

    fn receive_webhook(
        &self,
        _body: &str,
        _auth_token: &str,
    ) -> Result<CallWebhookEvent, CallError> {
        unreachable!("receive_webhook not exercised by these tests")
    }

    fn verify_access_token(&self, _token: &str) -> anyhow::Result<VerifiedRingToken> {
        unreachable!("verify_access_token not exercised by these tests")
    }

    async fn dispatch_transcription_agent(&self, _room_name: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

// Spawned post-archive workflows clone the repository. Give each clone the
// empty stable-voice result needed by the default voice-processing path.
impl Clone for MockCallRepository {
    fn clone(&self) -> Self {
        let mut repo = Self::new();
        repo.expect_get_stable_speaker_voices_for_call_record()
            .returning(|_| Box::pin(async { Ok(Vec::new()) }));
        repo
    }
}

#[derive(Clone, Debug, PartialEq)]
struct PublishedCallEvent {
    topic: &'static str,
    key: String,
    envelope: serde_json::Value,
}

#[derive(Clone, Default)]
struct RecordingEventBroker {
    events: Arc<Mutex<Vec<PublishedCallEvent>>>,
    fail_scheduling: bool,
}

impl RecordingEventBroker {
    fn failing() -> Self {
        Self {
            fail_scheduling: true,
            ..Self::default()
        }
    }

    fn events(&self) -> Vec<PublishedCallEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        if self.fail_scheduling {
            return Err(EventBrokerError::Publish(
                "intentional scheduling failure".to_string(),
            ));
        }

        self.events.lock().unwrap().push(PublishedCallEvent {
            topic: event.topic(),
            key: event.key().to_string(),
            envelope: serde_json::to_value(event.event())?,
        });

        Ok(tokio::spawn(async { Ok(()) }))
    }
}

#[derive(Clone, Copy)]
struct StubConnectionService;

impl ConnectionService for StubConnectionService {
    async fn send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        _invalidation_event: InvalidationEvent<'a, T>,
    ) -> Result<(), ConnectionError> {
        Ok(())
    }

    async fn send_channel_message<'a>(
        &self,
        _users: &[MacroUserIdStr<'a>],
        _message_type: &str,
        _message: serde_json::Value,
    ) -> Result<(), ConnectionError> {
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct StubNotificationIngress;

impl NotificationIngress for StubNotificationIngress {
    async fn send_notification<
        'a,
        T: notification::domain::models::Notification + Clone + 'static,
        U: serde::Serialize + Send + Sync + 'static,
    >(
        &'a self,
        _request: notification::domain::models::request::SendNotificationRequest<'a, T, U>,
    ) -> Result<
        Option<notification::domain::models::NotificationResult<'a>>,
        rootcause::Report<notification::domain::service::SendNotificationError>,
    > {
        unreachable!("notification sending is not exercised by get_or_create_call tests")
    }
}

#[derive(Clone, Copy)]
struct StubRecordingStorage;

impl crate::domain::ports::RecordingStorage for StubRecordingStorage {
    async fn presign_recording_url(&self, _recording_key: &str) -> anyhow::Result<String> {
        unreachable!("recording reads are not exercised by get_or_create_call tests")
    }

    async fn presign_recording_preview_url(&self, _preview_key: &str) -> anyhow::Result<String> {
        unreachable!("recording reads are not exercised by get_or_create_call tests")
    }

    async fn delete_recording(&self, _recording_key: &str) -> anyhow::Result<()> {
        unreachable!("recording deletion is not exercised by get_or_create_call tests")
    }

    async fn delete_recording_preview(&self, _preview_key: &str) -> anyhow::Result<()> {
        unreachable!("recording deletion is not exercised by get_or_create_call tests")
    }
}

const STARTED_EVENT_CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b6c7);
const STARTED_EVENT_CHANNEL_ID: Uuid = Uuid::from_u128(0x3f6f8b0a_6f9f_4a3f_9c3a_2b1e5d4c7a90);
const STARTED_EVENT_CREATOR: &str = "macro|creator@example.com";

#[derive(Clone, Copy)]
enum GetOrCreateScenario {
    CreatorWins,
    RaceLoses,
    ExistingCall,
}

fn started_event_timestamp() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-07-27T18:01:02Z")
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

fn started_event_call(created_by: &str) -> Call {
    Call {
        id: STARTED_EVENT_CALL_ID,
        channel_id: STARTED_EVENT_CHANNEL_ID,
        room_name: STARTED_EVENT_CHANNEL_ID.to_string(),
        created_by: created_by.to_string(),
        created_at: started_event_timestamp(),
        egress_id: None,
    }
}

fn mock_get_or_create_repo(
    scenario: GetOrCreateScenario,
    call: Call,
    recording_enabled: bool,
) -> MockCallRepository {
    let mut repo = MockCallRepository::new();

    match scenario {
        GetOrCreateScenario::CreatorWins => {
            repo.expect_get_call_by_channel_id()
                .times(1)
                .returning(|_| Box::pin(async { Ok(None) }));

            repo.expect_create_call()
                .times(1)
                .return_once(move |_, _, _, _| Box::pin(async move { Ok(Some(call)) }));

            repo.expect_resolve_channel_name()
                .times(1)
                .returning(|_, _| {
                    Box::pin(async {
                        Err(anyhow::anyhow!(
                            "skip push notifications in get_or_create_call tests"
                        ))
                    })
                });
        }
        GetOrCreateScenario::RaceLoses => {
            let mut sequence = mockall::Sequence::new();
            repo.expect_get_call_by_channel_id()
                .times(1)
                .in_sequence(&mut sequence)
                .returning(|_| Box::pin(async { Ok(None) }));
            repo.expect_get_call_by_channel_id()
                .times(1)
                .in_sequence(&mut sequence)
                .return_once(move |_| Box::pin(async move { Ok(Some(call)) }));
            repo.expect_create_call()
                .times(1)
                .returning(|_, _, _, _| Box::pin(async { Ok(None) }));
        }
        GetOrCreateScenario::ExistingCall => {
            repo.expect_get_call_by_channel_id()
                .times(1)
                .return_once(move |_| Box::pin(async move { Ok(Some(call)) }));
        }
    }

    if recording_enabled {
        repo.expect_set_egress_id()
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(()) }));
    }

    repo.expect_find_active_call_for_user()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_add_participant()
        .times(1)
        .returning(|call_id, user_id| {
            let participant = CallParticipant {
                call_id: *call_id,
                user_id: user_id.as_ref().to_string(),
                joined_at: started_event_timestamp(),
            };
            Box::pin(async move { Ok(participant) })
        });

    repo
}

type BaseGetOrCreateCallService = CallServiceImpl<
    MockCallRepository,
    MockRtcClient,
    StubConnectionService,
    NoOpEntityAccessService,
    StubNotificationIngress,
    StubRecordingStorage,
    NoopCallSummarizer,
>;

fn build_get_or_create_service<B: MacroEventBroker>(
    repo: MockCallRepository,
    event_broker: B,
    recording_enabled: bool,
) -> impl CallService {
    let service: BaseGetOrCreateCallService = CallServiceImpl::new(
        repo,
        MockRtcClient::new(),
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://livekit.example.com",
    );
    let service = if recording_enabled {
        service.with_egress(EgressS3Config {
            bucket: "recordings".to_string(),
            region: "us-east-1".to_string(),
            access_key: "access-key".to_string(),
            secret: "secret".to_string(),
        })
    } else {
        service
    };

    service.with_event_broker(event_broker)
}

async fn get_or_create_call(
    scenario: GetOrCreateScenario,
    created_by: &str,
    broker: RecordingEventBroker,
    recording_enabled: bool,
) -> Result<crate::domain::models::CallTokenResponse, CallError> {
    let call = started_event_call(created_by);
    let repo = mock_get_or_create_repo(scenario, call, recording_enabled);
    let service = build_get_or_create_service(repo, broker, recording_enabled);

    service
        .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user("requester@example.com"))
        .await
}

#[tokio::test]
async fn get_or_create_call_publishes_started_event() {
    let broker = RecordingEventBroker::default();

    let response = get_or_create_call(
        GetOrCreateScenario::CreatorWins,
        STARTED_EVENT_CREATOR,
        broker.clone(),
        true,
    )
    .await
    .expect("call creation succeeds");

    assert_eq!(response.call_id, STARTED_EVENT_CALL_ID);
    let events = broker.events();
    let [published] = events.as_slice() else {
        panic!("expected exactly one call event")
    };
    assert_eq!(published.topic, "macro.calls");
    assert_eq!(published.key, STARTED_EVENT_CALL_ID.to_string());
    assert!(!published.key.starts_with("call|"));

    let event_id = published.envelope["event_id"]
        .as_str()
        .expect("event id is a string");
    Uuid::parse_str(event_id).expect("event id is a UUID");

    let mut envelope = published.envelope.clone();
    envelope
        .as_object_mut()
        .expect("event envelope is an object")
        .remove("event_id");
    assert_eq!(
        envelope,
        json!({
            "schema_version": 1,
            "event_type": "call.started",
            "metadata": {
                "call_id": STARTED_EVENT_CALL_ID,
                "channel_id": STARTED_EVENT_CHANNEL_ID,
                "created_by": STARTED_EVENT_CREATOR,
                "created_at": "2026-07-27T18:01:02Z",
                "recording_enabled": true,
            },
        })
    );
}

#[tokio::test]
async fn get_or_create_call_race_loser_does_not_publish_started_event() {
    let broker = RecordingEventBroker::default();

    get_or_create_call(
        GetOrCreateScenario::RaceLoses,
        STARTED_EVENT_CREATOR,
        broker.clone(),
        false,
    )
    .await
    .expect("race loser joins the winning call");

    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn get_or_create_call_existing_call_does_not_publish_started_event() {
    let broker = RecordingEventBroker::default();

    get_or_create_call(
        GetOrCreateScenario::ExistingCall,
        STARTED_EVENT_CREATOR,
        broker.clone(),
        false,
    )
    .await
    .expect("existing call can be joined");

    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn broker_scheduling_failure_does_not_fail_call_creation() {
    let broker = RecordingEventBroker::failing();

    let response = get_or_create_call(
        GetOrCreateScenario::CreatorWins,
        STARTED_EVENT_CREATOR,
        broker.clone(),
        false,
    )
    .await
    .expect("broker failure is best-effort");

    assert_eq!(response.call_id, STARTED_EVENT_CALL_ID);
    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn malformed_stored_creator_skips_only_started_event() {
    let broker = RecordingEventBroker::default();

    let response = get_or_create_call(
        GetOrCreateScenario::CreatorWins,
        "malformed-user-id",
        broker.clone(),
        false,
    )
    .await
    .expect("malformed stored creator does not fail call creation");

    assert_eq!(response.call_id, STARTED_EVENT_CALL_ID);
    assert!(broker.events().is_empty());
}

const ARCHIVED_EVENT_CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b6d8);
const ARCHIVED_EVENT_CHANNEL_ID: Uuid = Uuid::from_u128(0x4f6f8b0a_6f9f_4a3f_9c3a_2b1e5d4c7a91);
const ARCHIVED_EVENT_ROOM_NAME: &str = "archived-event-room";
const ARCHIVED_EVENT_CREATOR: &str = "macro|archiver@example.com";
const ARCHIVED_EVENT_PARTICIPANT: &str = "participant@example.com";

fn archived_event_started_at() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-07-27T18:01:02Z")
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

fn archived_event_ended_at() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-07-27T18:04:05Z")
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

fn active_call_for_archived_event(created_by: &str, egress_id: Option<&str>) -> Call {
    Call {
        id: ARCHIVED_EVENT_CALL_ID,
        channel_id: ARCHIVED_EVENT_CHANNEL_ID,
        room_name: ARCHIVED_EVENT_ROOM_NAME.to_string(),
        created_by: created_by.to_string(),
        created_at: archived_event_started_at(),
        egress_id: egress_id.map(str::to_string),
    }
}

fn archived_call_for_event(
    created_by: &str,
    participant_count: usize,
    has_recording: bool,
) -> ArchivedCall {
    ArchivedCall {
        call_id: ARCHIVED_EVENT_CALL_ID,
        channel_id: ARCHIVED_EVENT_CHANNEL_ID,
        created_by: created_by.to_string(),
        started_at: archived_event_started_at(),
        ended_at: archived_event_ended_at(),
        duration_ms: 183_000,
        has_recording,
        participant_count,
    }
}

fn webhook_rtc_client(
    event_type: &str,
    participant_identity: Option<&'static str>,
) -> MockCallRtcClient {
    let event = CallWebhookEvent {
        event: event_type.to_string(),
        id: format!("{event_type}-event-id"),
        room_name: Some(ARCHIVED_EVENT_ROOM_NAME.to_string()),
        participant_identity: participant_identity.map(|email| user(email).into_owned()),
        egress_id: None,
        file_url: None,
        created_at: 1_775_000_000,
    };
    let mut rtc_client = MockCallRtcClient::new();
    rtc_client
        .expect_receive_webhook()
        .times(1)
        .return_once(move |body, auth_token| {
            assert_eq!(body, "webhook-body");
            assert_eq!(auth_token, "webhook-token");
            Ok(event)
        });
    rtc_client
}

type BaseWebhookCallService = CallServiceImpl<
    MockCallRepository,
    MockCallRtcClient,
    StubConnectionService,
    NoOpEntityAccessService,
    StubNotificationIngress,
    StubRecordingStorage,
    NoopCallSummarizer,
>;

fn build_webhook_service(
    repo: MockCallRepository,
    rtc_client: MockCallRtcClient,
    event_broker: RecordingEventBroker,
) -> impl CallService {
    let service: BaseWebhookCallService = CallServiceImpl::new(
        repo,
        rtc_client,
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://livekit.example.com",
    );
    service.with_event_broker(event_broker)
}

fn assert_archived_event(
    event_broker: &RecordingEventBroker,
    archive_reason: &str,
    participant_count: usize,
    has_recording: bool,
) {
    let events = event_broker.events();
    let [published] = events.as_slice() else {
        panic!("expected exactly one call event")
    };
    assert_eq!(published.topic, "macro.calls");
    assert_eq!(published.key, ARCHIVED_EVENT_CALL_ID.to_string());

    let event_id = published.envelope["event_id"]
        .as_str()
        .expect("event id is a string");
    Uuid::parse_str(event_id).expect("event id is a UUID");

    let mut envelope = published.envelope.clone();
    envelope
        .as_object_mut()
        .expect("event envelope is an object")
        .remove("event_id");
    assert_eq!(
        envelope,
        json!({
            "schema_version": 1,
            "event_type": "call.record_archived",
            "metadata": {
                "call_id": ARCHIVED_EVENT_CALL_ID,
                "channel_id": ARCHIVED_EVENT_CHANNEL_ID,
                "created_by": ARCHIVED_EVENT_CREATOR,
                "started_at": "2026-07-27T18:01:02Z",
                "ended_at": "2026-07-27T18:04:05Z",
                "duration_ms": 183_000,
                "participant_count": participant_count,
                "has_recording": has_recording,
                "archive_reason": archive_reason,
            },
        })
    );
}

#[tokio::test]
async fn participant_left_publishes_last_participant_archived_event() {
    let active_call = active_call_for_archived_event(ARCHIVED_EVENT_CREATOR, None);
    let archived_call = archived_call_for_event(ARCHIVED_EVENT_CREATOR, 4, false);
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_room_name()
        .times(1)
        .return_once(move |room_name| {
            assert_eq!(room_name, ARCHIVED_EVENT_ROOM_NAME);
            Box::pin(async move { Ok(Some(active_call)) })
        });
    repo.expect_remove_participant()
        .times(1)
        .returning(|call_id, participant_identity| {
            assert_eq!(*call_id, ARCHIVED_EVENT_CALL_ID);
            assert_eq!(
                participant_identity.as_ref(),
                user(ARCHIVED_EVENT_PARTICIPANT).as_ref()
            );
            Box::pin(async { Ok(()) })
        });
    repo.expect_get_participant_count()
        .times(1)
        .returning(|call_id| {
            assert_eq!(*call_id, ARCHIVED_EVENT_CALL_ID);
            Box::pin(async { Ok(0) })
        });
    repo.expect_archive_call()
        .times(1)
        .return_once(move |call_id| {
            assert_eq!(*call_id, ARCHIVED_EVENT_CALL_ID);
            Box::pin(async move { Ok(archived_call) })
        });

    let mut rtc_client = webhook_rtc_client("participant_left", Some(ARCHIVED_EVENT_PARTICIPANT));
    rtc_client
        .expect_delete_room()
        .times(1)
        .returning(|room_name| {
            assert_eq!(room_name, ARCHIVED_EVENT_ROOM_NAME);
            Box::pin(async { Ok(()) })
        });
    let event_broker = RecordingEventBroker::default();
    let service = build_webhook_service(repo, rtc_client, event_broker.clone());

    service
        .process_webhook_event("webhook-body", "webhook-token")
        .await
        .expect("participant-left webhook succeeds");

    assert_archived_event(&event_broker, "last_participant_left", 4, false);
}

#[tokio::test]
async fn room_finished_publishes_room_finished_archived_event() {
    let active_call = active_call_for_archived_event(
        "macro|stale-active-creator@example.com",
        Some("archived-event-egress"),
    );
    let archived_call = archived_call_for_event(ARCHIVED_EVENT_CREATOR, 3, true);
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_room_name()
        .times(1)
        .return_once(move |room_name| {
            assert_eq!(room_name, ARCHIVED_EVENT_ROOM_NAME);
            Box::pin(async move { Ok(Some(active_call)) })
        });
    repo.expect_archive_call()
        .times(1)
        .return_once(move |call_id| {
            assert_eq!(*call_id, ARCHIVED_EVENT_CALL_ID);
            Box::pin(async move { Ok(archived_call) })
        });

    let rtc_client = webhook_rtc_client("room_finished", None);
    let event_broker = RecordingEventBroker::default();
    let service = build_webhook_service(repo, rtc_client, event_broker.clone());

    service
        .process_webhook_event("webhook-body", "webhook-token")
        .await
        .expect("room-finished webhook succeeds");

    assert_archived_event(&event_broker, "room_finished", 3, true);
}

#[tokio::test]
async fn failed_archive_does_not_publish_archived_event() {
    let active_call = active_call_for_archived_event(ARCHIVED_EVENT_CREATOR, None);
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_room_name()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(Some(active_call)) }));
    repo.expect_archive_call()
        .times(1)
        .returning(|_| Box::pin(async { Err(anyhow::anyhow!("archive failed")) }));

    let rtc_client = webhook_rtc_client("room_finished", None);
    let event_broker = RecordingEventBroker::default();
    let service = build_webhook_service(repo, rtc_client, event_broker.clone());

    assert!(
        service
            .process_webhook_event("webhook-body", "webhook-token")
            .await
            .is_err()
    );
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn malformed_archived_creator_skips_event_without_undoing_archival() {
    let active_call = active_call_for_archived_event(ARCHIVED_EVENT_CREATOR, None);
    let archived_call = archived_call_for_event("malformed-user-id", 1, false);
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_room_name()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(Some(active_call)) }));
    repo.expect_archive_call()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(archived_call) }));

    let rtc_client = webhook_rtc_client("room_finished", None);
    let event_broker = RecordingEventBroker::default();
    let service = build_webhook_service(repo, rtc_client, event_broker.clone());

    service
        .process_webhook_event("webhook-body", "webhook-token")
        .await
        .expect("malformed creator does not undo archival");
    assert!(event_broker.events().is_empty());
}

#[cfg(feature = "outbound")]
const CALL1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000000ca110);
#[cfg(feature = "outbound")]
const MACRO_USER_A: Uuid = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaaa1);
#[cfg(feature = "outbound")]
const MACRO_USER_B: Uuid = Uuid::from_u128(0xbbbbbbbb_bbbb_bbbb_bbbb_bbbbbbbbbbb2);

#[cfg(feature = "outbound")]
fn axis_unit_vector(axis: usize) -> Vec<f32> {
    let mut v = vec![0.0_f32; 256];
    v[axis] = 1.0;
    v
}

#[cfg(feature = "outbound")]
async fn insert_voice(
    pool: &sqlx::Pool<sqlx::Postgres>,
    voice_id: Uuid,
    axis: usize,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO voice (id, embedding) VALUES ($1, $2)")
        .bind(voice_id)
        .bind(pgvector::Vector::from(axis_unit_vector(axis)))
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(feature = "outbound")]
async fn insert_user_mapping(
    pool: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserIdStr<'_>,
    macro_user_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(macro_user_id)
    .bind(user_id.as_ref())
    .bind(user_id.email_str())
    .bind(format!("cus_{macro_user_id}"))
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, "stripeCustomerId", macro_user_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET macro_user_id = EXCLUDED.macro_user_id
        "#,
    )
    .bind(user_id.as_ref())
    .bind(user_id.email_str())
    .bind(format!("cus_{macro_user_id}"))
    .bind(macro_user_id)
    .execute(pool)
    .await?;

    Ok(())
}

#[test]
fn extract_key_from_full_s3_url() {
    let url = "https://macro-call-recording-prod.s3.amazonaws.com/calls/0195cea6-fc16-72f2-93b6-144df711f270/2026-04-10T210832.mp4";
    assert_eq!(
        extract_recording_key(url),
        "0195cea6-fc16-72f2-93b6-144df711f270/2026-04-10T210832.mp4"
    );
}

#[test]
fn extract_key_fallback_when_no_calls_prefix() {
    let url = "s3://bucket/some/other/path.mp4";
    assert_eq!(extract_recording_key(url), url);
}

#[test]
fn extract_key_from_bare_calls_path() {
    let url = "calls/abc-123/recording.mp4";
    assert_eq!(extract_recording_key(url), "abc-123/recording.mp4");
}

#[test]
fn derive_preview_key_from_recording_key_uses_recording_stem_path() {
    assert_eq!(
        derive_preview_key_from_recording_key("abc-123/recording.mp4").as_deref(),
        Some("calls/abc-123/recording/PREVIEW.jpg")
    );
}

#[test]
fn derive_preview_key_from_recording_key_accepts_prefixed_recording_key() {
    assert_eq!(
        derive_preview_key_from_recording_key("calls/abc-123/recording.mp4").as_deref(),
        Some("calls/abc-123/recording/PREVIEW.jpg")
    );
}

#[test]
fn derive_preview_key_from_recording_key_strips_only_trailing_mp4_suffix() {
    assert_eq!(
        derive_preview_key_from_recording_key("abc-123/recording.v1.mp4").as_deref(),
        Some("calls/abc-123/recording.v1/PREVIEW.jpg")
    );
}

#[test]
fn derive_preview_key_from_recording_key_returns_none_without_parent() {
    assert!(derive_preview_key_from_recording_key("recording.mp4").is_none());
}

#[test]
fn derive_preview_keys_from_recording_key_includes_new_and_legacy_mp4_paths() {
    assert_eq!(
        derive_preview_keys_from_recording_key("abc-123/recording.mp4"),
        vec![
            "calls/abc-123/recording/PREVIEW.jpg".to_string(),
            "calls/abc-123/recording.mp4/PREVIEW.jpg".to_string(),
        ]
    );
}

#[test]
fn exclude_voip_recipients_keeps_users_without_voip_delivery() {
    let alice = user("alice@example.com");
    let bob = user("bob@example.com");
    let recipients = HashSet::from([alice.clone(), bob.clone()]);
    let voip_recipients = HashSet::from([alice]);

    let filtered = exclude_voip_recipients(recipients, &voip_recipients);

    assert_eq!(filtered, HashSet::from([bob]));
}

#[test]
fn exclude_voip_recipients_returns_empty_when_all_users_received_voip() {
    let alice = user("alice@example.com");
    let bob = user("bob@example.com");
    let recipients = HashSet::from([alice.clone(), bob.clone()]);
    let voip_recipients = HashSet::from([alice, bob]);

    let filtered = exclude_voip_recipients(recipients, &voip_recipients);

    assert!(filtered.is_empty());
}

#[tokio::test]
async fn build_voip_push_payloads_mints_a_distinct_token_per_recipient() {
    let alice = user("alice@example.com").into_owned();
    let bob = user("bob@example.com").into_owned();
    let mock = MockRtcClient::new();
    mock.set_token(alice.as_ref(), Ok("token-alice".to_string()));
    mock.set_token(bob.as_ref(), Ok("token-bob".to_string()));

    let recipients = vec![alice.clone(), bob.clone()];
    let payloads = mock
        .build_voip_push_payloads(VoipPushPayloadRequest {
            recipients: &recipients,
            room_name: "room-1",
            call_id: Uuid::nil(),
            channel_id: "channel-1",
            channel_name: "general",
            caller_name: "Carla",
            livekit_server_url: "wss://lk.example",
            ring_status_url: Some("https://api.example/call/ring-status/0"),
        })
        .await;

    assert_eq!(payloads.len(), 2);
    for (_, payload) in &payloads {
        assert_eq!(
            payload.ring_status_url.as_deref(),
            Some("https://api.example/call/ring-status/0"),
            "ring_status_url should propagate into every recipient's payload"
        );
    }
    let by_id: HashMap<String, String> = payloads
        .into_iter()
        .map(|(id, p)| {
            (
                id.as_ref().to_string(),
                p.livekit_token.expect("livekit_token populated on success"),
            )
        })
        .collect();
    assert_eq!(by_id.get(alice.as_ref()).unwrap(), "token-alice");
    assert_eq!(by_id.get(bob.as_ref()).unwrap(), "token-bob");
    assert_eq!(mock.calls().len(), 2);
    for (room, _) in mock.calls() {
        assert_eq!(room, "room-1");
    }
}

#[tokio::test]
async fn build_voip_push_payloads_drops_recipients_whose_token_mint_fails() {
    let alice = user("alice@example.com").into_owned();
    let bob = user("bob@example.com").into_owned();
    let mock = MockRtcClient::new();
    mock.set_token(alice.as_ref(), Ok("token-alice".to_string()));
    mock.set_token(bob.as_ref(), Err(anyhow::anyhow!("livekit unreachable")));

    let recipients = vec![alice.clone(), bob.clone()];
    let payloads = mock
        .build_voip_push_payloads(VoipPushPayloadRequest {
            recipients: &recipients,
            room_name: "room-1",
            call_id: Uuid::nil(),
            channel_id: "channel-1",
            channel_name: "general",
            caller_name: "Carla",
            livekit_server_url: "wss://lk.example",
            ring_status_url: None,
        })
        .await;

    assert_eq!(
        payloads.len(),
        1,
        "bob's failed token mint should not block alice's payload"
    );
    let (id, payload) = &payloads[0];
    assert_eq!(id.as_ref(), alice.as_ref());
    assert_eq!(payload.livekit_token.as_deref(), Some("token-alice"));
    assert_eq!(
        payload.ring_status_url, None,
        "payload omits ring_status_url when the service has no base URL configured"
    );
}

#[tokio::test]
async fn build_voip_push_payloads_returns_empty_for_no_recipients() {
    let mock = MockRtcClient::new();
    let recipients: Vec<MacroUserIdStr<'static>> = Vec::new();

    let payloads = mock
        .build_voip_push_payloads(VoipPushPayloadRequest {
            recipients: &recipients,
            room_name: "room-1",
            call_id: Uuid::nil(),
            channel_id: "channel-1",
            channel_name: "general",
            caller_name: "Carla",
            livekit_server_url: "wss://lk.example",
            ring_status_url: None,
        })
        .await;

    assert!(payloads.is_empty());
    assert!(mock.calls().is_empty());
}

fn active_call(call_id: Uuid) -> Call {
    Call {
        id: call_id,
        channel_id: Uuid::nil(),
        room_name: Uuid::nil().to_string(),
        created_by: "macro|carla@example.com".to_string(),
        created_at: chrono::Utc::now(),
        egress_id: None,
    }
}

#[test]
fn resolve_ring_status_reports_ended_when_no_active_call() {
    let call_id = Uuid::from_u128(1);
    assert_eq!(
        resolve_ring_status(None, &call_id, false),
        RingStatus::Ended
    );
}

#[test]
fn resolve_ring_status_reports_ended_when_a_newer_call_replaced_the_polled_one() {
    let polled = Uuid::from_u128(1);
    let newer = active_call(Uuid::from_u128(2));
    assert_eq!(
        resolve_ring_status(Some(&newer), &polled, true),
        RingStatus::Ended,
        "a different active call in the room means the polled ring is dead"
    );
}

#[test]
fn resolve_ring_status_reports_answered_when_user_is_a_participant() {
    let call_id = Uuid::from_u128(1);
    let call = active_call(call_id);
    assert_eq!(
        resolve_ring_status(Some(&call), &call_id, true),
        RingStatus::Answered
    );
}

#[test]
fn resolve_ring_status_reports_ringing_when_user_has_not_joined() {
    let call_id = Uuid::from_u128(1);
    let call = active_call(call_id);
    assert_eq!(
        resolve_ring_status(Some(&call), &call_id, false),
        RingStatus::Ringing
    );
}

#[cfg(feature = "outbound")]
#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn enroll_stable_speaker_voices_links_all_voices_for_consistent_diarized_speakers(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    use crate::domain::models::TranscriptSegmentRequest;
    use crate::domain::ports::{CallRepository as _, VoiceRepository as _};
    use crate::outbound::{pg_call_repo::PgCallRepo, pg_voice_repo::PgVoiceRepo};
    use chrono::{Duration, Utc};

    let call_repo = PgCallRepo::new(pool.clone());
    let voice_repo = PgVoiceRepo::new(pool.clone());
    let user_a = MacroUserIdStr::parse_from_str("macro|user-a@test.com")?;
    let user_b = MacroUserIdStr::parse_from_str("macro|user-b@test.com")?;
    let voice_a = macro_uuid::generate_uuid_v7();
    let voice_b = macro_uuid::generate_uuid_v7();
    let now = Utc::now();

    insert_user_mapping(&pool, &user_a, MACRO_USER_A).await?;
    insert_user_mapping(&pool, &user_b, MACRO_USER_B).await?;
    insert_voice(&pool, voice_a, 0).await?;
    insert_voice(&pool, voice_b, 1).await?;

    let segments = [
        ("stable-a-1", user_a.as_ref(), Some("spk-a0"), voice_a),
        ("stable-a-2", user_a.as_ref(), Some("spk-a0"), voice_b),
        ("ambiguous-b-1", user_b.as_ref(), Some("spk-b0"), voice_a),
        ("ambiguous-b-2", user_b.as_ref(), Some("spk-b1"), voice_b),
    ];

    for (idx, (segment_id, speaker_id, diarized_speaker_id, voice_id)) in
        segments.into_iter().enumerate()
    {
        let started_at = now + Duration::seconds(idx as i64);
        call_repo
            .create_transcript_segment(
                &CALL1,
                &TranscriptSegmentRequest {
                    segment_id: segment_id.to_string(),
                    speaker_id: speaker_id.to_string(),
                    diarized_speaker_id: diarized_speaker_id.map(str::to_string),
                    content: segment_id.to_string(),
                    started_at,
                    ended_at: Some(started_at + Duration::milliseconds(100)),
                    is_final: true,
                    stream_started_at: None,
                    embedding: None,
                },
                Some(voice_id),
            )
            .await?;
    }

    let archived = call_repo.archive_call(&CALL1).await?;

    super::enroll_stable_speaker_voices_for_call_record(&call_repo, &voice_repo, archived.call_id)
        .await;

    let mut user_a_voices = voice_repo.get_user_voices(&MACRO_USER_A).await?;
    user_a_voices.sort();
    let mut expected = vec![voice_a, voice_b];
    expected.sort();
    assert_eq!(user_a_voices, expected);
    assert!(voice_repo.get_user_voices(&MACRO_USER_B).await?.is_empty());
    Ok(())
}
