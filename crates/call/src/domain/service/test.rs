use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use connection::domain::models::{ConnectionError, InvalidationEvent};
use connection::domain::ports::ConnectionService;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, EntityType};
use entity_access::domain::ports::NoOpEntityAccessService;
use entity_mutation::{DeleteEntityPermanently, UpdateEntitySharePolicy};
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::{
    TeamShareFacts, TeamShareGrant, TeamShareLevel,
};
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
    group_recipients_by_channel_name, resolve_ring_status,
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
    async fn generate_guest_token(
        &self,
        _room: &str,
        _identity: &str,
        _name: &str,
    ) -> anyhow::Result<String> {
        unreachable!("guest token not exercised")
    }
    async fn remove_guest(&self, _room: &str, _identity: &str) -> anyhow::Result<()> {
        unreachable!("guest removal not exercised")
    }

    async fn create_room(&self, _room_name: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn delete_room(&self, _room_name: &str) -> anyhow::Result<()> {
        Ok(())
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
        channel_id: Some(STARTED_EVENT_CHANNEL_ID),
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

            repo.expect_create_call().times(1).return_once(
                move |call_id, channel_id, room_name, _| {
                    assert_eq!(room_name, call_id.to_string());
                    assert_ne!(room_name, channel_id.to_string());
                    Box::pin(async move { Ok(Some(call)) })
                },
            );

