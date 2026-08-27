use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use connection::domain::models::{ConnectionError, InvalidationEvent};
use connection::domain::ports::ConnectionService;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, EntityType};
use entity_access::domain::ports::NoOpEntityAccessService;
use entity_mutation::DeleteEntityPermanently;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::apple::VoipPushPayload;
use notification::domain::service::NotificationIngress;
use serde_json::json;
use uuid::Uuid;

use crate::domain::models::{
    ActiveCallSummary, AddParticipantError, ArchivedCall, Call, CallError, CallParticipant,
    CallRecord, CallRecordTranscriptSegment, CallWebhookEvent, DeletedCallRecordStorageKeys,
    EditCallRecordRequest, EgressS3Config, RingStatus, VerifiedRingToken, VoipPushPayloadRequest,
};
use crate::domain::ports::{
    CallRtcClient, CallService, CallSummarizer, MockCallRepository, MockCallRtcClient,
    NoOpVoiceRepository,
};

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

fn configured_repository_clones() -> &'static Mutex<HashMap<usize, MockCallRepository>> {
    static REPOSITORIES: OnceLock<Mutex<HashMap<usize, MockCallRepository>>> = OnceLock::new();
    REPOSITORIES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn configure_repository_clone(repo: &MockCallRepository, cloned_repo: MockCallRepository) {
    let repo_address = repo as *const MockCallRepository as usize;
    let previous = configured_repository_clones()
        .lock()
        .unwrap()
        .insert(repo_address, cloned_repo);
    assert!(previous.is_none(), "repository clone already configured");
}

// Spawned post-archive workflows clone the repository. Tests that exercise a
// spawned repository operation install a purpose-built clone; other tests get
// the empty stable-voice result needed by the default voice-processing path.
impl Clone for MockCallRepository {
    fn clone(&self) -> Self {
        let repo_address = self as *const Self as usize;
        if let Some(repo) = configured_repository_clones()
            .lock()
            .unwrap()
            .remove(&repo_address)
        {
            return repo;
        }

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
    attempts: Arc<AtomicUsize>,
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

    fn attempts(&self) -> usize {
        self.attempts.load(Ordering::SeqCst)
    }
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.attempts.fetch_add(1, Ordering::SeqCst);
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

#[derive(Clone)]
struct SentChannelMessage {
    users: Vec<String>,
    message_type: String,
    message: serde_json::Value,
}

#[derive(Clone, Default)]
struct RecordingConnectionService {
    messages: Arc<Mutex<Vec<SentChannelMessage>>>,
}

impl RecordingConnectionService {
    fn messages(&self) -> Vec<SentChannelMessage> {
        self.messages.lock().unwrap().clone()
    }
}

impl ConnectionService for RecordingConnectionService {
    async fn send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        _invalidation_event: InvalidationEvent<'a, T>,
    ) -> Result<(), ConnectionError> {
        Ok(())
    }

    async fn send_channel_message<'a>(
        &self,
        users: &[MacroUserIdStr<'a>],
        message_type: &str,
        message: serde_json::Value,
    ) -> Result<(), ConnectionError> {
        self.messages.lock().unwrap().push(SentChannelMessage {
            users: users.iter().map(|u| u.as_ref().to_string()).collect(),
            message_type: message_type.to_string(),
            message,
        });
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

type BaseGetOrCreateCallService<Cn> = CallServiceImpl<
    MockCallRepository,
    MockRtcClient,
    Cn,
    NoOpEntityAccessService,
    StubNotificationIngress,
    StubRecordingStorage,
    NoopCallSummarizer,
>;

fn build_get_or_create_service<B: MacroEventBroker + Clone, Cn: ConnectionService>(
    repo: MockCallRepository,
    connection_service: Cn,
    event_broker: B,
    recording_enabled: bool,
) -> impl CallService {
    let service: BaseGetOrCreateCallService<Cn> = CallServiceImpl::new(
        repo,
        MockRtcClient::new(),
        connection_service,
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
    let service =
        build_get_or_create_service(repo, StubConnectionService, broker, recording_enabled);

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

#[tokio::test]
async fn get_or_create_call_sends_call_answered_to_joining_user() {
    let call = started_event_call(STARTED_EVENT_CREATOR);
    let repo = mock_get_or_create_repo(GetOrCreateScenario::ExistingCall, call, false);
    let connection_service = RecordingConnectionService::default();
    let service = build_get_or_create_service(
        repo,
        connection_service.clone(),
        RecordingEventBroker::default(),
        false,
    );

    service
        .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user("requester@example.com"))
        .await
        .expect("joining an existing call succeeds");

    let messages = connection_service.messages();
    let [message] = messages.as_slice() else {
        panic!("expected exactly one channel message")
    };
    assert_eq!(message.message_type, "call_answered");
    assert_eq!(
        message.users,
        vec![user("requester@example.com").as_ref().to_string()]
    );
    assert_eq!(
        message.message,
        json!({
            "channel_id": STARTED_EVENT_CHANNEL_ID,
            "call_id": STARTED_EVENT_CALL_ID,
            "user_id": user("requester@example.com").as_ref(),
        })
    );
}

const ARCHIVED_EVENT_CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b6d8);
const ARCHIVED_EVENT_CHANNEL_ID: Uuid = Uuid::from_u128(0x4f6f8b0a_6f9f_4a3f_9c3a_2b1e5d4c7a91);
const ARCHIVED_EVENT_ROOM_NAME: &str = "archived-event-room";
const ARCHIVED_EVENT_CREATOR: &str = "macro|archiver@example.com";
const ARCHIVED_EVENT_PARTICIPANT: &str = "participant@example.com";
const RECORDING_READY_EGRESS_ID: &str = "recording-ready-egress";
const RECORDING_READY_FILE_URL: &str =
    "https://recordings.example.com/calls/0198a1b2-c3d4-7e5f-8061-728394a5b6d8/recording.mp4";
const RECORDING_READY_KEY: &str = "0198a1b2-c3d4-7e5f-8061-728394a5b6d8/recording.mp4";

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

fn egress_ended_rtc_client(egress_id: Option<&str>, file_url: Option<&str>) -> MockCallRtcClient {
    let event = CallWebhookEvent {
        event: "egress_ended".to_string(),
        id: "egress-ended-event-id".to_string(),
        room_name: None,
        participant_identity: None,
        egress_id: egress_id.map(str::to_string),
        file_url: file_url.map(str::to_string),
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

type BaseWebhookCallService<Cn> = CallServiceImpl<
    MockCallRepository,
    MockCallRtcClient,
    Cn,
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
    build_webhook_service_with_connection(repo, rtc_client, StubConnectionService, event_broker)
}

fn build_webhook_service_with_connection<Cn: ConnectionService>(
    repo: MockCallRepository,
    rtc_client: MockCallRtcClient,
    connection_service: Cn,
    event_broker: RecordingEventBroker,
) -> impl CallService {
    let service: BaseWebhookCallService<Cn> = CallServiceImpl::new(
        repo,
        rtc_client,
        connection_service,
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

#[tokio::test]
async fn participant_joined_webhook_sends_call_answered_to_answering_user() {
    let active_call = active_call_for_archived_event(ARCHIVED_EVENT_CREATOR, None);
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_room_name()
        .times(1)
        .return_once(move |room_name| {
            assert_eq!(room_name, ARCHIVED_EVENT_ROOM_NAME);
            Box::pin(async move { Ok(Some(active_call)) })
        });
    repo.expect_add_participant()
        .times(1)
        .returning(|call_id, participant_identity| {
            assert_eq!(*call_id, ARCHIVED_EVENT_CALL_ID);
            assert_eq!(
                participant_identity.as_ref(),
                user(ARCHIVED_EVENT_PARTICIPANT).as_ref()
            );
            let participant = CallParticipant {
                call_id: *call_id,
                user_id: participant_identity.as_ref().to_string(),
                joined_at: archived_event_started_at(),
            };
            Box::pin(async move { Ok(participant) })
        });

    let rtc_client = webhook_rtc_client("participant_joined", Some(ARCHIVED_EVENT_PARTICIPANT));
    let connection_service = RecordingConnectionService::default();
    let service = build_webhook_service_with_connection(
        repo,
        rtc_client,
        connection_service.clone(),
        RecordingEventBroker::default(),
    );

    service
        .process_webhook_event("webhook-body", "webhook-token")
        .await
        .expect("participant-joined webhook succeeds");

    let messages = connection_service.messages();
    let [message] = messages.as_slice() else {
        panic!("expected exactly one channel message")
    };
    assert_eq!(message.message_type, "call_answered");
    assert_eq!(
        message.users,
        vec![user(ARCHIVED_EVENT_PARTICIPANT).as_ref().to_string()]
    );
    assert_eq!(
        message.message,
        json!({
            "channel_id": ARCHIVED_EVENT_CHANNEL_ID,
            "call_id": ARCHIVED_EVENT_CALL_ID,
            "user_id": user(ARCHIVED_EVENT_PARTICIPANT).as_ref(),
        })
    );
}

#[tokio::test]
async fn participant_joined_webhook_skips_call_answered_on_state_drift() {
    let active_call = active_call_for_archived_event(ARCHIVED_EVENT_CREATOR, None);
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_room_name()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(Some(active_call)) }));
    repo.expect_add_participant()
        .times(1)
        .returning(|_, _| Box::pin(async { Err(AddParticipantError::UserAlreadyActive) }));

    let rtc_client = webhook_rtc_client("participant_joined", Some(ARCHIVED_EVENT_PARTICIPANT));
    let connection_service = RecordingConnectionService::default();
    let service = build_webhook_service_with_connection(
        repo,
        rtc_client,
        connection_service.clone(),
        RecordingEventBroker::default(),
    );

    service
        .process_webhook_event("webhook-body", "webhook-token")
        .await
        .expect("state drift does not fail the webhook");

    assert!(connection_service.messages().is_empty());
}

fn assert_recording_ready_event(event_broker: &RecordingEventBroker) {
    let events = event_broker.events();
    let [published] = events.as_slice() else {
        panic!("expected exactly one recording-ready event")
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
            "event_type": "call.recording_ready",
            "metadata": {
                "call_id": ARCHIVED_EVENT_CALL_ID,
                "channel_id": ARCHIVED_EVENT_CHANNEL_ID,
            },
        })
    );
    assert!(!published.envelope.to_string().contains(RECORDING_READY_KEY));
}

#[tokio::test]
async fn archived_egress_ended_publishes_recording_ready_event() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_record_by_egress_id()
        .times(1)
        .returning(|egress_id| {
            assert_eq!(egress_id, RECORDING_READY_EGRESS_ID);
            Box::pin(async { Ok(Some((ARCHIVED_EVENT_CALL_ID, ARCHIVED_EVENT_CHANNEL_ID))) })
        });
    repo.expect_set_recording_key()
        .times(1)
        .returning(|call_id, recording_key| {
            assert_eq!(*call_id, ARCHIVED_EVENT_CALL_ID);
            assert_eq!(recording_key, RECORDING_READY_KEY);
            Box::pin(async { Ok(()) })
        });
    let rtc_client = egress_ended_rtc_client(
        Some(RECORDING_READY_EGRESS_ID),
        Some(RECORDING_READY_FILE_URL),
    );
    let event_broker = RecordingEventBroker::default();
    let service = build_webhook_service(repo, rtc_client, event_broker.clone());

    service
        .process_webhook_event("webhook-body", "webhook-token")
        .await
        .expect("archived egress-ended webhook succeeds");

    assert_recording_ready_event(&event_broker);
}

#[tokio::test]
async fn active_egress_ended_does_not_publish_recording_ready_event() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_record_by_egress_id()
        .times(1)
        .returning(|egress_id| {
            assert_eq!(egress_id, RECORDING_READY_EGRESS_ID);
            Box::pin(async { Ok(None) })
        });
    repo.expect_set_active_call_recording_key()
        .times(1)
        .returning(|egress_id, recording_key| {
            assert_eq!(egress_id, RECORDING_READY_EGRESS_ID);
            assert_eq!(recording_key, RECORDING_READY_KEY);
            Box::pin(async { Ok(true) })
        });
    let rtc_client = egress_ended_rtc_client(
        Some(RECORDING_READY_EGRESS_ID),
        Some(RECORDING_READY_FILE_URL),
    );
    let event_broker = RecordingEventBroker::default();
    let service = build_webhook_service(repo, rtc_client, event_broker.clone());

    service
        .process_webhook_event("webhook-body", "webhook-token")
        .await
        .expect("active egress-ended webhook succeeds");

    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn egress_ended_with_missing_fields_does_not_publish_recording_ready_event() {
    for (egress_id, file_url) in [
        (None, Some(RECORDING_READY_FILE_URL)),
        (Some(RECORDING_READY_EGRESS_ID), None),
    ] {
        let repo = MockCallRepository::new();
        let rtc_client = egress_ended_rtc_client(egress_id, file_url);
        let event_broker = RecordingEventBroker::default();
        let service = build_webhook_service(repo, rtc_client, event_broker.clone());

        service
            .process_webhook_event("webhook-body", "webhook-token")
            .await
            .expect("incomplete egress-ended webhook is ignored");

        assert!(event_broker.events().is_empty());
    }
}

#[tokio::test]
async fn unknown_egress_ended_does_not_publish_recording_ready_event() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_record_by_egress_id()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_set_active_call_recording_key()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(false) }));
    let rtc_client = egress_ended_rtc_client(
        Some(RECORDING_READY_EGRESS_ID),
        Some(RECORDING_READY_FILE_URL),
    );
    let event_broker = RecordingEventBroker::default();
    let service = build_webhook_service(repo, rtc_client, event_broker.clone());

    service
        .process_webhook_event("webhook-body", "webhook-token")
        .await
        .expect("unknown egress-ended webhook is ignored");

    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn failed_recording_key_persistence_does_not_publish_recording_ready_event() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_record_by_egress_id()
        .times(1)
        .returning(|_| {
            Box::pin(async { Ok(Some((ARCHIVED_EVENT_CALL_ID, ARCHIVED_EVENT_CHANNEL_ID))) })
        });
    repo.expect_set_recording_key()
        .times(1)
        .returning(|_, _| Box::pin(async { Err(anyhow::anyhow!("recording key write failed")) }));
    let rtc_client = egress_ended_rtc_client(
        Some(RECORDING_READY_EGRESS_ID),
        Some(RECORDING_READY_FILE_URL),
    );
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

const MUTATED_EVENT_CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b6e9);
const MUTATED_EVENT_CHANNEL_ID: Uuid = Uuid::from_u128(0x5f6f8b0a_6f9f_4a3f_9c3a_2b1e5d4c7a92);
const MUTATED_EVENT_ACTOR: &str = "macro|editor@example.com";

fn call_record_for_mutation() -> CallRecord {
    CallRecord {
        call_id: MUTATED_EVENT_CALL_ID,
        channel_id: MUTATED_EVENT_CHANNEL_ID,
        room_name: "mutation-event-room".to_string(),
        created_by: "macro|creator@example.com".to_string(),
        started_at: archived_event_started_at(),
        ended_at: Some(archived_event_ended_at()),
        duration_ms: Some(183_000),
        egress_id: None,
        recording_started_at: None,
        recording_key: None,
        preview_key: None,
        recording_url: None,
        recording_preview_url: None,
        channel_name: None,
        custom_name: None,
        summary: None,
        share_with_team: false,
        is_active: false,
        status: None,
        user_access_level: None,
        participants: Vec::new(),
        transcript: Vec::new(),
    }
}

fn authenticated_mutation_receipt() -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user("editor@example.com"),
        &MUTATED_EVENT_CALL_ID.to_string(),
        EntityType::Call,
    )
}

fn internal_mutation_receipt() -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_internal_user(
        &MUTATED_EVENT_CALL_ID.to_string(),
        EntityType::Call,
    )
}

type BaseMutationCallService = CallServiceImpl<
    MockCallRepository,
    MockRtcClient,
    StubConnectionService,
    NoOpEntityAccessService,
    StubNotificationIngress,
    StubRecordingStorage,
    NoopCallSummarizer,
>;

fn build_mutation_service(
    repo: MockCallRepository,
    event_broker: RecordingEventBroker,
) -> impl CallService + DeleteEntityPermanently<Receipt = EditAccessLevel> {
    let service: BaseMutationCallService = CallServiceImpl::new(
        repo,
        MockRtcClient::new(),
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://livekit.example.com",
    );
    service.with_event_broker(event_broker)
}

fn assert_updated_event(
    event_broker: &RecordingEventBroker,
    actor_user_id: Option<&str>,
    custom_name: Option<&str>,
    share_with_team: Option<bool>,
) {
    let events = event_broker.events();
    let [published] = events.as_slice() else {
        panic!("expected exactly one call event")
    };
    assert_eq!(published.topic, "macro.calls");
    assert_eq!(published.key, MUTATED_EVENT_CALL_ID.to_string());

    let mut envelope = published.envelope.clone();
    envelope
        .as_object_mut()
        .expect("event envelope is an object")
        .remove("event_id");
    assert_eq!(
        envelope,
        json!({
            "schema_version": 1,
            "event_type": "call.record_updated",
            "metadata": {
                "call_id": MUTATED_EVENT_CALL_ID,
                "channel_id": MUTATED_EVENT_CHANNEL_ID,
                "actor_user_id": actor_user_id,
                "custom_name": custom_name,
                "share_with_team": share_with_team,
            },
        })
    );
}

fn assert_deleted_event(event_broker: &RecordingEventBroker) {
    let events = event_broker.events();
    let [published] = events.as_slice() else {
        panic!("expected exactly one call event")
    };
    assert_eq!(published.topic, "macro.calls");
    assert_eq!(published.key, MUTATED_EVENT_CALL_ID.to_string());

    let mut envelope = published.envelope.clone();
    envelope
        .as_object_mut()
        .expect("event envelope is an object")
        .remove("event_id");
    assert_eq!(
        envelope,
        json!({
            "schema_version": 1,
            "event_type": "call.record_deleted",
            "metadata": {
                "call_id": MUTATED_EVENT_CALL_ID,
                "channel_id": MUTATED_EVENT_CHANNEL_ID,
                "actor_user_id": MUTATED_EVENT_ACTOR,
            },
        })
    );
}

// -- get_active_calls ---------------------------------------------------------

#[tokio::test]
async fn get_active_calls_maps_repo_rows_into_response() {
    let summary = ActiveCallSummary {
        call_id: MUTATED_EVENT_CALL_ID,
        channel_id: MUTATED_EVENT_CHANNEL_ID,
        created_by: "macro|user-a@test.com".to_string(),
        created_at: started_event_timestamp(),
        participant_count: 2,
    };
    let mut repo = MockCallRepository::new();
    repo.expect_get_active_calls_for_user()
        .times(1)
        .return_once(move |user_id| {
            assert_eq!(user_id.as_ref(), "macro|viewer@example.com");
            Box::pin(async move { Ok(vec![summary]) })
        });
    let service = build_mutation_service(repo, RecordingEventBroker::default());

    let response = service
        .get_active_calls(user("viewer@example.com"))
        .await
        .expect("get_active_calls should succeed");

    assert_eq!(response.calls.len(), 1);
    assert_eq!(response.calls[0].call_id, MUTATED_EVENT_CALL_ID);
    assert_eq!(response.calls[0].channel_id, MUTATED_EVENT_CHANNEL_ID);
    assert_eq!(response.calls[0].participant_count, 2);
}

#[tokio::test]
async fn get_active_calls_wraps_repo_error_as_internal() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_active_calls_for_user()
        .times(1)
        .returning(|_| Box::pin(async { Err(anyhow::anyhow!("db down")) }));
    let service = build_mutation_service(repo, RecordingEventBroker::default());

    let err = service
        .get_active_calls(user("viewer@example.com"))
        .await
        .expect_err("repo failure should surface");

    assert!(matches!(err, CallError::Internal(_)));
}

fn mock_edit_repo(
    record: Option<CallRecord>,
    expected_custom_name: Option<&'static str>,
    expected_share_with_team: Option<bool>,
    expect_share_permission: bool,
    patch_result: anyhow::Result<()>,
) -> MockCallRepository {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_record_by_call_id()
        .times(1)
        .return_once(move |call_id| {
            assert_eq!(*call_id, MUTATED_EVENT_CALL_ID);
            Box::pin(async move { Ok(record) })
        });
    repo.expect_patch_call_record()
        .times(1)
        .return_once(move |call_id, request| {
            assert_eq!(*call_id, MUTATED_EVENT_CALL_ID);
            assert_eq!(request.custom_name.as_deref(), expected_custom_name);
            assert_eq!(request.share_with_team, expected_share_with_team);
            assert_eq!(request.share_permission.is_some(), expect_share_permission);
            Box::pin(async move { patch_result })
        });
    repo
}

#[tokio::test]
async fn edit_call_record_publishes_updated_event() {
    let repo = mock_edit_repo(
        Some(call_record_for_mutation()),
        Some("Weekly sync"),
        None,
        false,
        Ok(()),
    );
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    service
        .edit_call_record(
            authenticated_mutation_receipt(),
            EditCallRecordRequest {
                share_permission: None,
                share_with_team: None,
                custom_name: Some("Weekly sync".to_string()),
            },
        )
        .await
        .expect("rename succeeds");

    assert_updated_event(
        &event_broker,
        Some(MUTATED_EVENT_ACTOR),
        Some("Weekly sync"),
        None,
    );
}

#[tokio::test]
async fn edit_call_record_publishes_updated_event_when_name_is_cleared() {
    let repo = mock_edit_repo(
        Some(call_record_for_mutation()),
        Some(""),
        None,
        false,
        Ok(()),
    );
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    service
        .edit_call_record(
            authenticated_mutation_receipt(),
            EditCallRecordRequest {
                share_permission: None,
                share_with_team: None,
                custom_name: Some(String::new()),
            },
        )
        .await
        .expect("clearing the name succeeds");

    assert_updated_event(&event_broker, Some(MUTATED_EVENT_ACTOR), Some(""), None);
}

#[tokio::test]
async fn edit_call_record_publishes_updated_event_for_share_permission_only() {
    let repo = mock_edit_repo(Some(call_record_for_mutation()), None, None, true, Ok(()));
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    service
        .edit_call_record(
            authenticated_mutation_receipt(),
            EditCallRecordRequest {
                share_permission: Some(
                    models_permissions::share_permission::UpdateSharePermissionRequestV2 {
                        link_share: Some(Some(
                            models_permissions::share_permission::LinkShare::Public,
                        )),
                        link_share_access_level: None,
                        channel_share_permissions: None,
                    },
                ),
                share_with_team: None,
                custom_name: None,
            },
        )
        .await
        .expect("share-permission update succeeds");

    assert_updated_event(&event_broker, Some(MUTATED_EVENT_ACTOR), None, None);
    assert!(
        !event_broker.events()[0]
            .envelope
            .to_string()
            .contains("share_permission")
    );
}

#[tokio::test]
async fn edit_call_record_publishes_updated_event_without_an_internal_actor() {
    let repo = mock_edit_repo(
        Some(call_record_for_mutation()),
        Some("Internal rename"),
        Some(false),
        false,
        Ok(()),
    );
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    service
        .edit_call_record(
            internal_mutation_receipt(),
            EditCallRecordRequest {
                share_permission: None,
                share_with_team: Some(false),
                custom_name: Some("Internal rename".to_string()),
            },
        )
        .await
        .expect("internal edit succeeds");

    assert_updated_event(&event_broker, None, Some("Internal rename"), Some(false));
}

#[tokio::test]
async fn edit_call_record_skips_updated_event_for_unknown_record() {
    let repo = mock_edit_repo(None, Some("Unknown"), None, false, Ok(()));
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    service
        .edit_call_record(
            authenticated_mutation_receipt(),
            EditCallRecordRequest {
                share_permission: None,
                share_with_team: None,
                custom_name: Some("Unknown".to_string()),
            },
        )
        .await
        .expect("unknown record edit remains idempotent");

    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn failed_edit_call_record_does_not_publish_updated_event() {
    let repo = mock_edit_repo(
        Some(call_record_for_mutation()),
        Some("Failed rename"),
        None,
        false,
        Err(anyhow::anyhow!("patch failed")),
    );
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    assert!(
        service
            .edit_call_record(
                authenticated_mutation_receipt(),
                EditCallRecordRequest {
                    share_permission: None,
                    share_with_team: None,
                    custom_name: Some("Failed rename".to_string()),
                },
            )
            .await
            .is_err()
    );
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn toggle_share_with_team_publishes_updated_event() {
    let mut repo = MockCallRepository::new();
    repo.expect_toggle_share_with_team()
        .times(1)
        .returning(|call_id| {
            assert_eq!(*call_id, MUTATED_EVENT_CALL_ID);
            Box::pin(async { Ok((true, MUTATED_EVENT_CHANNEL_ID)) })
        });
    repo.expect_get_participants()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    let share_with_team = service
        .toggle_share_with_team(authenticated_mutation_receipt())
        .await
        .expect("share toggle succeeds");

    assert!(share_with_team);
    assert_updated_event(&event_broker, Some(MUTATED_EVENT_ACTOR), None, Some(true));
}

#[tokio::test]
async fn failed_toggle_share_with_team_does_not_publish_updated_event() {
    let mut repo = MockCallRepository::new();
    repo.expect_toggle_share_with_team()
        .times(1)
        .returning(|_| Box::pin(async { Err(anyhow::anyhow!("toggle failed")) }));
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    assert!(
        service
            .toggle_share_with_team(authenticated_mutation_receipt())
            .await
            .is_err()
    );
    assert!(event_broker.events().is_empty());
}

fn mock_delete_repo(
    record: Option<CallRecord>,
    delete_result: anyhow::Result<Option<DeletedCallRecordStorageKeys>>,
) -> MockCallRepository {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_record_by_call_id()
        .times(1)
        .return_once(move |call_id| {
            assert_eq!(*call_id, MUTATED_EVENT_CALL_ID);
            Box::pin(async move { Ok(record) })
        });
    repo.expect_delete_call_record()
        .times(1)
        .return_once(move |call_id| {
            assert_eq!(*call_id, MUTATED_EVENT_CALL_ID);
            Box::pin(async move { delete_result })
        });
    repo
}

#[tokio::test]
async fn delete_call_record_publishes_deleted_event() {
    let repo = mock_delete_repo(
        Some(call_record_for_mutation()),
        Ok(Some(DeletedCallRecordStorageKeys::default())),
    );
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    service
        .delete_call_record(authenticated_mutation_receipt())
        .await
        .expect("deletion succeeds");

    assert_deleted_event(&event_broker);
}

#[tokio::test]
async fn no_op_delete_call_record_does_not_publish_deleted_event() {
    let repo = mock_delete_repo(None, Ok(None));
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    service
        .delete_call_record(authenticated_mutation_receipt())
        .await
        .expect("unknown record deletion remains idempotent");

    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn failed_delete_call_record_does_not_publish_deleted_event() {
    let repo = mock_delete_repo(
        Some(call_record_for_mutation()),
        Err(anyhow::anyhow!("delete failed")),
    );
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());

    assert!(
        service
            .delete_call_record(authenticated_mutation_receipt())
            .await
            .is_err()
    );
    assert!(event_broker.events().is_empty());
}

#[tokio::test]
async fn delete_entity_permanently_publishes_one_deleted_event() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_record_by_call_id()
        .times(2)
        .returning(|call_id| {
            assert_eq!(*call_id, MUTATED_EVENT_CALL_ID);
            Box::pin(async { Ok(Some(call_record_for_mutation())) })
        });
    repo.expect_resolve_channel_name()
        .times(1)
        .returning(|channel_id, user_id| {
            assert_eq!(*channel_id, MUTATED_EVENT_CHANNEL_ID);
            assert_eq!(user_id.as_ref(), MUTATED_EVENT_ACTOR);
            Box::pin(async { Ok(None) })
        });
    repo.expect_delete_call_record()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Some(DeletedCallRecordStorageKeys::default())) }));
    let event_broker = RecordingEventBroker::default();
    let service = build_mutation_service(repo, event_broker.clone());
    let entity =
        model_entity::EntityType::Call.with_entity_string(MUTATED_EVENT_CALL_ID.to_string());

    service
        .delete_entity_permanently(entity, authenticated_mutation_receipt())
        .await
        .expect("entity mutation deletion succeeds");

    assert_deleted_event(&event_broker);
}

const SUMMARIZED_EVENT_CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b700);
const SUMMARIZED_EVENT_CHANNEL_ID: Uuid = Uuid::from_u128(0x6f6f8b0a_6f9f_4a3f_9c3a_2b1e5d4c7a93);
const SUMMARIZED_EVENT_SUMMARY: &str = "Private generated summary text";
const SUMMARIZED_EVENT_NAME: &str = "Private generated call name";

#[derive(Clone, Copy)]
enum GeneratedNameResult {
    Generated,
    NoName,
    Failed,
}

#[derive(Clone)]
struct StubCallSummarizer {
    summary: Option<&'static str>,
    generated_name: GeneratedNameResult,
    summary_calls: Arc<AtomicUsize>,
    name_calls: Arc<AtomicUsize>,
}

impl StubCallSummarizer {
    fn new(summary: Option<&'static str>, generated_name: GeneratedNameResult) -> Self {
        Self {
            summary,
            generated_name,
            summary_calls: Arc::new(AtomicUsize::new(0)),
            name_calls: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn name_calls(&self) -> usize {
        self.name_calls.load(Ordering::SeqCst)
    }
}

impl CallSummarizer for StubCallSummarizer {
    type Err = anyhow::Error;

    async fn summarize_call(
        &self,
        call_id: &Uuid,
        transcript: Vec<CallRecordTranscriptSegment>,
    ) -> Result<Option<String>, Self::Err> {
        assert_eq!(*call_id, SUMMARIZED_EVENT_CALL_ID);
        assert_eq!(transcript.len(), 1);
        self.summary_calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.summary.map(str::to_string))
    }

    async fn generate_call_name(
        &self,
        call_id: &Uuid,
        summary: &str,
    ) -> Result<Option<String>, Self::Err> {
        assert_eq!(*call_id, SUMMARIZED_EVENT_CALL_ID);
        assert_eq!(summary, SUMMARIZED_EVENT_SUMMARY);
        self.name_calls.fetch_add(1, Ordering::SeqCst);

        match self.generated_name {
            GeneratedNameResult::Generated => Ok(Some(SUMMARIZED_EVENT_NAME.to_string())),
            GeneratedNameResult::NoName => Ok(None),
            GeneratedNameResult::Failed => Err(anyhow::anyhow!("call naming failed")),
        }
    }

    async fn generate_custom_speakers(
        &self,
        _transcript: Vec<crate::domain::models::EnrichedCallTranscript>,
        _candidate_speakers: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<crate::domain::models::CallTranscriptCustomSpeakerResult>, Self::Err> {
        Ok(Vec::new())
    }
}

#[derive(Clone, Copy)]
enum NamePersistence {
    NotAttempted,
    Persisted(bool),
    Failed,
}

fn summarized_call_record(custom_name: Option<&str>) -> CallRecord {
    CallRecord {
        call_id: SUMMARIZED_EVENT_CALL_ID,
        channel_id: SUMMARIZED_EVENT_CHANNEL_ID,
        room_name: SUMMARIZED_EVENT_CHANNEL_ID.to_string(),
        created_by: "macro|creator@example.com".to_string(),
        started_at: started_event_timestamp(),
        ended_at: Some(started_event_timestamp()),
        duration_ms: Some(10_000),
        egress_id: None,
        recording_started_at: None,
        recording_key: None,
        preview_key: None,
        recording_url: None,
        recording_preview_url: None,
        channel_name: None,
        custom_name: custom_name.map(str::to_string),
        summary: None,
        share_with_team: false,
        is_active: false,
        status: None,
        user_access_level: None,
        participants: Vec::new(),
        transcript: vec![CallRecordTranscriptSegment {
            transcript_id: Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b701),
            segment_id: Some("segment-1".to_string()),
            speaker_id: "macro|speaker@example.com".to_string(),
            diarized_speaker_id: Some("speaker-1".to_string()),
            content: "Discuss the event publication behavior.".to_string(),
            started_at: started_event_timestamp(),
            ended_at: Some(started_event_timestamp()),
            sequence_num: 1,
        }],
    }
}

fn mock_summarization_repo(
    custom_name: Option<&str>,
    summary_persisted: Option<bool>,
    name_persistence: NamePersistence,
) -> MockCallRepository {
    let mut repo = MockCallRepository::new();
    repo.expect_get_enhanced_call_record_transcripts()
        .times(1)
        .returning(|call_id| {
            assert_eq!(*call_id, SUMMARIZED_EVENT_CALL_ID);
            Box::pin(async { Ok(Vec::new()) })
        });

    let record = summarized_call_record(custom_name);
    repo.expect_get_call_record_by_call_id()
        .times(1)
        .return_once(move |call_id| {
            assert_eq!(*call_id, SUMMARIZED_EVENT_CALL_ID);
            Box::pin(async move { Ok(Some(record)) })
        });

    if let Some(summary_persisted) = summary_persisted {
        repo.expect_insert_call_summary()
            .times(1)
            .returning(move |call_id, summary| {
                assert_eq!(*call_id, SUMMARIZED_EVENT_CALL_ID);
                assert_eq!(summary, SUMMARIZED_EVENT_SUMMARY);
                Box::pin(async move { Ok(summary_persisted) })
            });
    }

    match name_persistence {
        NamePersistence::NotAttempted => {}
        NamePersistence::Persisted(name_persisted) => {
            repo.expect_set_custom_name_if_null()
                .times(1)
                .returning(move |call_id, name| {
                    assert_eq!(*call_id, SUMMARIZED_EVENT_CALL_ID);
                    assert_eq!(name, SUMMARIZED_EVENT_NAME);
                    Box::pin(async move { Ok(name_persisted) })
                });
        }
        NamePersistence::Failed => {
            repo.expect_set_custom_name_if_null()
                .times(1)
                .returning(|call_id, name| {
                    assert_eq!(*call_id, SUMMARIZED_EVENT_CALL_ID);
                    assert_eq!(name, SUMMARIZED_EVENT_NAME);
                    Box::pin(async { Err(anyhow::anyhow!("name persistence failed")) })
                });
        }
    }

    repo
}

type SummarizationCallService<B> = CallServiceImpl<
    MockCallRepository,
    MockRtcClient,
    StubConnectionService,
    NoOpEntityAccessService,
    StubNotificationIngress,
    StubRecordingStorage,
    StubCallSummarizer,
    (),
    NoOpVoiceRepository,
    B,
>;

fn build_summarization_service<B: MacroEventBroker>(
    repo: MockCallRepository,
    summarizer: StubCallSummarizer,
    event_broker: B,
) -> SummarizationCallService<B> {
    let service = CallServiceImpl::new(
        repo,
        MockRtcClient::new(),
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://livekit.example.com",
    )
    .with_summarizer(summarizer);

    service.with_event_broker(event_broker)
}

async fn run_direct_summarization(
    custom_name: Option<&str>,
    summary: Option<&'static str>,
    summary_persisted: Option<bool>,
    generated_name: GeneratedNameResult,
    name_persistence: NamePersistence,
    event_broker: RecordingEventBroker,
) -> (RecordingEventBroker, StubCallSummarizer) {
    let repo = mock_summarization_repo(custom_name, summary_persisted, name_persistence);
    let summarizer = StubCallSummarizer::new(summary, generated_name);
    let observed_broker = event_broker.clone();
    let service = build_summarization_service(repo, summarizer.clone(), event_broker);

    service
        .summarize_call(&SUMMARIZED_EVENT_CALL_ID)
        .await
        .expect("summarization succeeds");

    (observed_broker, summarizer)
}

fn assert_summarized_event(event_broker: &RecordingEventBroker, ai_name_generated: bool) {
    let events = event_broker.events();
    let [published] = events.as_slice() else {
        panic!("expected exactly one summarized event")
    };
    assert_eq!(published.topic, "macro.calls");
    assert_eq!(published.key, SUMMARIZED_EVENT_CALL_ID.to_string());

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
            "event_type": "call.record_summarized",
            "metadata": {
                "call_id": SUMMARIZED_EVENT_CALL_ID,
                "channel_id": SUMMARIZED_EVENT_CHANNEL_ID,
                "ai_name_generated": ai_name_generated,
            },
        })
    );

    let serialized_event = published.envelope.to_string();
    assert!(!serialized_event.contains(SUMMARIZED_EVENT_SUMMARY));
    assert!(!serialized_event.contains(SUMMARIZED_EVENT_NAME));
}

async fn wait_for_spawned_work(mut is_complete: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while !is_complete() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("spawned summarization completed before timeout");
}

#[tokio::test]
async fn summarize_call_publishes_record_summarized_event() {
    let (broker, _) = run_direct_summarization(
        None,
        Some(SUMMARIZED_EVENT_SUMMARY),
        Some(true),
        GeneratedNameResult::Generated,
        NamePersistence::Persisted(true),
        RecordingEventBroker::default(),
    )
    .await;
    assert_summarized_event(&broker, true);

    let (no_summary_broker, no_summary_summarizer) = run_direct_summarization(
        None,
        None,
        None,
        GeneratedNameResult::Generated,
        NamePersistence::NotAttempted,
        RecordingEventBroker::default(),
    )
    .await;
    assert!(no_summary_broker.events().is_empty());
    assert_eq!(no_summary_summarizer.name_calls(), 0);

    let (deleted_record_broker, _) = run_direct_summarization(
        None,
        Some(SUMMARIZED_EVENT_SUMMARY),
        Some(false),
        GeneratedNameResult::Generated,
        NamePersistence::Persisted(false),
        RecordingEventBroker::default(),
    )
    .await;
    assert!(deleted_record_broker.events().is_empty());

    let failing_broker = RecordingEventBroker::failing();
    let (observed_failing_broker, _) = run_direct_summarization(
        Some("User-provided name"),
        Some(SUMMARIZED_EVENT_SUMMARY),
        Some(true),
        GeneratedNameResult::Generated,
        NamePersistence::NotAttempted,
        failing_broker,
    )
    .await;
    assert_eq!(observed_failing_broker.attempts(), 1);
    assert!(observed_failing_broker.events().is_empty());
}

#[tokio::test]
async fn spawned_summarization_publishes_record_summarized_event() {
    let event_broker = RecordingEventBroker::default();
    let summarizer = StubCallSummarizer::new(
        Some(SUMMARIZED_EVENT_SUMMARY),
        GeneratedNameResult::Generated,
    );
    let service =
        build_summarization_service(MockCallRepository::new(), summarizer, event_broker.clone());
    configure_repository_clone(
        &service.repo,
        mock_summarization_repo(None, Some(true), NamePersistence::Persisted(true)),
    );

    service.spawn_summarize_call(SUMMARIZED_EVENT_CALL_ID);
    wait_for_spawned_work(|| !event_broker.events().is_empty()).await;
    assert_summarized_event(&event_broker, true);

    let failing_broker = RecordingEventBroker::failing();
    let summarizer = StubCallSummarizer::new(
        Some(SUMMARIZED_EVENT_SUMMARY),
        GeneratedNameResult::Generated,
    );
    let service = build_summarization_service(
        MockCallRepository::new(),
        summarizer,
        failing_broker.clone(),
    );
    configure_repository_clone(
        &service.repo,
        mock_summarization_repo(None, Some(true), NamePersistence::Persisted(true)),
    );

    service.spawn_summarize_call(SUMMARIZED_EVENT_CALL_ID);
    wait_for_spawned_work(|| failing_broker.attempts() == 1).await;
    assert!(failing_broker.events().is_empty());
}

#[tokio::test]
async fn summarized_event_reports_ai_name_persistence() {
    let cases = [
        (
            None,
            GeneratedNameResult::Generated,
            NamePersistence::Persisted(true),
            true,
            1,
        ),
        (
            Some("User-provided name"),
            GeneratedNameResult::Generated,
            NamePersistence::NotAttempted,
            false,
            0,
        ),
        (
            None,
            GeneratedNameResult::NoName,
            NamePersistence::NotAttempted,
            false,
            1,
        ),
        (
            None,
            GeneratedNameResult::Failed,
            NamePersistence::NotAttempted,
            false,
            1,
        ),
        (
            None,
            GeneratedNameResult::Generated,
            NamePersistence::Persisted(false),
            false,
            1,
        ),
        (
            None,
            GeneratedNameResult::Generated,
            NamePersistence::Failed,
            false,
            1,
        ),
    ];

    for (custom_name, generated_name, name_persistence, expected_ai_name, expected_name_calls) in
        cases
    {
        let (broker, summarizer) = run_direct_summarization(
            custom_name,
            Some(SUMMARIZED_EVENT_SUMMARY),
            Some(true),
            generated_name,
            name_persistence,
            RecordingEventBroker::default(),
        )
        .await;

        assert_summarized_event(&broker, expected_ai_name);
        assert_eq!(summarizer.name_calls(), expected_name_calls);
    }
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
