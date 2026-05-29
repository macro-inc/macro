use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::apple::VoipPushPayload;
use uuid::Uuid;

use crate::domain::models::{CallError, CallWebhookEvent, EgressS3Config, VoipPushPayloadRequest};
use crate::domain::ports::CallRtcClient;

use super::{exclude_voip_recipients, extract_recording_key};

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
        unreachable!("create_room not exercised by these tests")
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
        unreachable!("start_room_composite_egress not exercised by these tests")
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

    async fn dispatch_transcription_agent(&self, _room_name: &str) -> anyhow::Result<()> {
        unreachable!("dispatch_transcription_agent not exercised by these tests")
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
        })
        .await;

    assert_eq!(payloads.len(), 2);
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
        })
        .await;

    assert!(payloads.is_empty());
    assert!(mock.calls().is_empty());
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

    let call_record_id = call_repo.archive_call(&CALL1).await?;

    super::enroll_stable_speaker_voices_for_call_record(&call_repo, &voice_repo, call_record_id)
        .await;

    let mut user_a_voices = voice_repo.get_user_voices(&MACRO_USER_A).await?;
    user_a_voices.sort();
    let mut expected = vec![voice_a, voice_b];
    expected.sort();
    assert_eq!(user_a_voices, expected);
    assert!(voice_repo.get_user_voices(&MACRO_USER_B).await?.is_empty());
    Ok(())
}
