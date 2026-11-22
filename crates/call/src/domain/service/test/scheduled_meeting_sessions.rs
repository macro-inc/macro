//! End to end through the call service and the real Postgres repository: a
//! scheduled meeting that empties ends its RTC session as any call does, and
//! a rejoin through its link before the scheduled end continues the same call
//! in a new room.

use std::collections::VecDeque;

use tokio::sync::mpsc;

use super::*;
use crate::domain::meetings::{CreateMeetingRequest, MeetingRtcParticipant};
use crate::domain::models::{LeaveCallResponse, LiveCallParticipant};
use crate::outbound::pg_call_repo::PgCallRepo;
use crate::outbound::scheduled_call_resume::AlwaysResumeScheduledCalls;
use sqlx::{Pool, Postgres};

const HOST_ID: Uuid = Uuid::from_u128(0x5c4e_d000_0000_0000_0000_0000_0000_00a1);
const ATTENDEE_ID: Uuid = Uuid::from_u128(0x5c4e_d000_0000_0000_0000_0000_0000_00b2);
const HOST: &str = "scheduled-host@example.com";
const ATTENDEE: &str = "scheduled-attendee@example.com";

/// What the service asked of the RTC provider.
#[derive(Debug, Clone, PartialEq, Eq)]
enum RtcRequest {
    CreateRoom(String),
    DeleteRoom(String),
    Transcription(String),
    Recording(String),
    StopRecording(String),
}

/// An RTC provider with empty rooms that reports every room and media
/// request, and delivers queued webhooks.
struct RecordingRtc {
    requests: mpsc::UnboundedSender<RtcRequest>,
    webhooks: Mutex<VecDeque<CallWebhookEvent>>,
}

impl RecordingRtc {
    fn report(&self, request: RtcRequest) {
        self.requests.send(request).ok();
    }
}

impl CallRtcClient for RecordingRtc {
    async fn create_room(&self, room_name: &str) -> anyhow::Result<()> {
        self.report(RtcRequest::CreateRoom(room_name.to_string()));
        Ok(())
    }
    async fn prepare_room(&self, room_name: &str) -> anyhow::Result<()> {
        self.create_room(room_name).await
    }
    async fn delete_room(&self, room_name: &str) -> anyhow::Result<()> {
        self.report(RtcRequest::DeleteRoom(room_name.to_string()));
        Ok(())
    }
    async fn list_rooms(&self) -> anyhow::Result<Vec<RtcRoom>> {
        Ok(Vec::new())
    }
    async fn list_meeting_participants(
        &self,
        _room_name: &str,
    ) -> anyhow::Result<Option<Vec<MeetingRtcParticipant>>> {
        Ok(None)
    }
    async fn list_live_participants(
        &self,
        _room_name: &str,
    ) -> anyhow::Result<Option<Vec<LiveCallParticipant>>> {
        Ok(None)
    }
    async fn generate_token<'a>(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'a>,
    ) -> anyhow::Result<String> {
        Ok(format!("token:{room_name}:{participant_identity}"))
    }
    async fn generate_named_token<'a>(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'a>,
        _name: &str,
    ) -> anyhow::Result<String> {
        self.generate_token(room_name, participant_identity).await
    }
    async fn generate_program_token<'a>(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'a>,
        _program: &str,
        _name: Option<String>,
    ) -> anyhow::Result<String> {
        self.generate_token(room_name, participant_identity).await
    }
    async fn generate_bot_token(
        &self,
        room_name: &str,
        bot_id: bot_id::BotId,
        _name: Option<String>,
    ) -> anyhow::Result<String> {
        Ok(format!("bot-token:{room_name}:{bot_id:?}"))
    }
    async fn generate_guest_token(
        &self,
        room_name: &str,
        guest_id: GuestId,
        _display_name: &str,
    ) -> anyhow::Result<String> {
        Ok(format!("guest-token:{room_name}:{guest_id}"))
    }
    async fn remove_guest(&self, _room_name: &str, _guest_id: GuestId) -> anyhow::Result<()> {
        Ok(())
    }
    async fn remove_bot(&self, _room_name: &str, _bot_id: bot_id::BotId) -> anyhow::Result<()> {
        Ok(())
    }
    async fn build_voip_push_payloads<'a>(
        &self,
        _request: VoipPushPayloadRequest<'a>,
    ) -> Vec<(MacroUserIdStr<'static>, VoipPushPayload)> {
        Vec::new()
    }
    async fn remove_participant<'a>(
        &self,
        _room_name: &str,
        _participant_identity: MacroUserIdStr<'a>,
    ) -> anyhow::Result<()> {
        Ok(())
    }
    async fn list_participant_identities(
        &self,
        _room_name: &str,
    ) -> anyhow::Result<Option<Vec<String>>> {
        Ok(Some(Vec::new()))
    }
    async fn start_room_composite_egress(
        &self,
        room_name: &str,
        _s3_config: &EgressS3Config,
    ) -> anyhow::Result<String> {
        self.report(RtcRequest::Recording(room_name.to_string()));
        Ok(format!("egress:{room_name}"))
    }
    async fn stop_egress(&self, egress_id: &str) -> anyhow::Result<()> {
        self.report(RtcRequest::StopRecording(egress_id.to_string()));
        Ok(())
    }
    fn receive_webhook(
        &self,
        _body: &str,
        _auth_token: &str,
    ) -> Result<CallWebhookEvent, CallError> {
        self.webhooks
            .lock()
            .unwrap()
            .pop_front()
            .ok_or(CallError::Auth)
    }
    fn verify_access_token(&self, _token: &str) -> anyhow::Result<VerifiedRingToken> {
        anyhow::bail!("ring tokens are not used by meeting joins")
    }
    async fn dispatch_transcription_agent(&self, room_name: &str) -> anyhow::Result<()> {
        self.report(RtcRequest::Transcription(room_name.to_string()));
        Ok(())
    }
}

struct Harness {
    service: CallServiceImpl<
        PgCallRepo,
        RecordingRtc,
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        StubRecordingStorage,
        NoopCallSummarizer,
        (),
        NoOpVoiceRepository,
        RecordingEventBroker,
    >,
    requests: mpsc::UnboundedReceiver<RtcRequest>,
    events: RecordingEventBroker,
    host: MacroUserIdStr<'static>,
    attendee: MacroUserIdStr<'static>,
}

impl Harness {
    async fn new(pool: &Pool<Postgres>, resume: bool) -> anyhow::Result<Self> {
        let host = user(HOST);
        let attendee = user(ATTENDEE);
        insert_user_mapping(pool, &host, HOST_ID).await?;
        insert_user_mapping(pool, &attendee, ATTENDEE_ID).await?;
        let (sender, requests) = mpsc::unbounded_channel();
        let events = RecordingEventBroker::default();
        let service = CallServiceImpl::new(
            PgCallRepo::new(pool.clone()),
            RecordingRtc {
                requests: sender,
                webhooks: Mutex::default(),
            },
            StubConnectionService,
            NoOpEntityAccessService,
            StubNotificationIngress,
            StubRecordingStorage,
            "wss://livekit.example.com",
        )
        .with_egress(EgressS3Config {
            bucket: "recordings".into(),
            region: "test".into(),
            access_key: "test".into(),
            secret: "test".into(),
        })
        .with_event_broker(events.clone());
        let service = if resume {
            service.with_scheduled_call_resume_gate(AlwaysResumeScheduledCalls)
        } else {
            service
        };
        Ok(Self {
            service,
            requests,
            events,
            host,
            attendee,
        })
    }

    /// Waits until the provider has seen every one of `expected`, in any order.
    async fn expect_rtc(&mut self, expected: &[RtcRequest]) {
        let mut missing = expected.to_vec();
        let wait = async {
            while !missing.is_empty() {
                let request = self.requests.recv().await.expect("the RTC client is alive");
                if let Some(index) = missing.iter().position(|wanted| *wanted == request) {
                    missing.swap_remove(index);
                }
            }
        };
        tokio::time::timeout(std::time::Duration::from_secs(5), wait)
            .await
            .unwrap_or_else(|_| panic!("RTC requests never made: {missing:?}"));
    }

    fn deliver_webhook(&self, event: &str, room_name: &str, participant: Option<&'static str>) {
        self.service
            .rtc_client
            .webhooks
            .lock()
            .unwrap()
            .push_back(CallWebhookEvent {
                event: event.to_string(),
                id: format!("{event}-{room_name}"),
                room_name: Some(room_name.to_string()),
                participant_identity: participant.map(|email| user(email).into_owned()),
                guest_identity: None,
                bot_identity: None,
                egress_id: None,
                file_url: None,
                created_at: Utc::now().timestamp(),
            });
    }

    fn published(&self, event_type: &str, call_id: Uuid) -> usize {
        self.events
            .events()
            .iter()
            .filter(|event| {
                event.envelope["event_type"] == event_type && event.key == call_id.to_string()
            })
            .count()
    }

    async fn scheduled_meeting(&self) -> anyhow::Result<crate::domain::meetings::Meeting> {
        let now = Utc::now();
        Ok(self
            .service
            .create_meeting(
                self.host.copied(),
                CreateMeetingRequest {
                    preparation_id: None,
                    title: Some("Weekly review".to_string()),
                    scheduled_start: Some(now - chrono::Duration::minutes(5)),
                    scheduled_end: Some(now + chrono::Duration::minutes(55)),
                },
            )
            .await?)
    }

    async fn leave(
        &self,
        call_id: Uuid,
        who: MacroUserIdStr<'_>,
    ) -> anyhow::Result<LeaveCallResponse> {
        Ok(self.service.leave_call(&call_id, who).await?)
    }
}

async fn records_for_meeting(pool: &Pool<Postgres>, meeting_id: Uuid) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM call_records WHERE meeting_id = $1"#,
        meeting_id
    )
    .fetch_one(pool)
    .await?)
}

async fn live_room(pool: &Pool<Postgres>, call_id: Uuid) -> anyhow::Result<Option<String>> {
    Ok(
        sqlx::query_scalar!("SELECT room_name FROM calls WHERE id = $1", call_id)
            .fetch_optional(pool)
            .await?,
    )
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_scheduled_meeting_rejoined_before_its_end_is_one_call_in_two_rooms(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let mut harness = Harness::new(&pool, true).await?;
    let meeting = harness.scheduled_meeting().await?;
    let token = meeting.share_token.clone();

    // The host starts the call alone and leaves: the call ends like any
    // other, and its room and recording go with it.
    let first = harness
        .service
        .join_meeting(token.clone(), harness.host.copied())
        .await?;
    assert!(first.started);
    let call_id = first.call_id;
    let first_room = first.room_name.clone();
    harness
        .expect_rtc(&[
            RtcRequest::CreateRoom(first_room.clone()),
            RtcRequest::Transcription(first_room.clone()),
            RtcRequest::Recording(first_room.clone()),
        ])
        .await;
    assert!(
        harness
            .leave(call_id, harness.host.copied())
            .await?
            .call_ended
    );
    harness
        .expect_rtc(&[
            RtcRequest::StopRecording(format!("egress:{first_room}")),
            RtcRequest::DeleteRoom(first_room.clone()),
        ])
        .await;
    assert_eq!(live_room(&pool, call_id).await?, None);
    assert_eq!(records_for_meeting(&pool, meeting.id).await?, 1);

    // Someone else arrives through the link later in the slot: the same call
    // goes live again in a new room, with its own transcription and recording.
    let second = harness
        .service
        .join_meeting(token.clone(), harness.attendee.copied())
        .await?;
    assert_eq!(second.call_id, call_id);
    assert!(second.started);
    let second_room = second.room_name.clone();
    assert_ne!(second_room, first_room);
    assert_ne!(second_room, call_id.to_string());
    harness
        .expect_rtc(&[
            RtcRequest::CreateRoom(second_room.clone()),
            RtcRequest::Transcription(second_room.clone()),
            RtcRequest::Recording(second_room.clone()),
        ])
        .await;

    // Late webhooks from the first room never touch the live session.
    harness.deliver_webhook("room_finished", &first_room, None);
    harness
        .service
        .process_webhook_event("body", "token")
        .await?;
    harness.deliver_webhook("participant_left", &first_room, Some(HOST));
    harness
        .service
        .process_webhook_event("body", "token")
        .await?;
    assert_eq!(live_room(&pool, call_id).await?, Some(second_room.clone()));

    // The sweeper leaves the new session alone while it is settling in.
    harness.service.reconcile_stale_calls().await?;
    assert_eq!(live_room(&pool, call_id).await?, Some(second_room.clone()));

    // When it empties it ends too, and merges into the one record.
    assert!(
        harness
            .leave(call_id, harness.attendee.copied())
            .await?
            .call_ended
    );
    harness
        .expect_rtc(&[
            RtcRequest::StopRecording(format!("egress:{second_room}")),
            RtcRequest::DeleteRoom(second_room.clone()),
        ])
        .await;
    assert_eq!(live_room(&pool, call_id).await?, None);
    assert_eq!(records_for_meeting(&pool, meeting.id).await?, 1);
    let sessions = sqlx::query_scalar!(
        "SELECT room_name FROM call_record_sessions WHERE call_record_id = $1",
        call_id
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(sessions, vec![second_room]);

    // One call started; each session's end archived it.
    assert_eq!(harness.published("call.started", call_id), 1);
    assert_eq!(harness.published("call.record_archived", call_id), 2);

    // Once the slot is over, the link starts a new call.
    sqlx::query!(
        "UPDATE call_meetings SET scheduled_start = now() - interval '2 hours', scheduled_end = now() - interval '1 hour' WHERE id = $1",
        meeting.id
    )
    .execute(&pool)
    .await?;
    let next = harness
        .service
        .join_meeting(token, harness.host.copied())
        .await?;
    assert!(next.started);
    assert_ne!(next.call_id, call_id);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn an_instant_meeting_rejoined_is_two_calls(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let harness = Harness::new(&pool, true).await?;
    let meeting = harness
        .service
        .create_meeting(
            harness.host.copied(),
            CreateMeetingRequest {
                preparation_id: None,
                title: None,
                scheduled_start: None,
                scheduled_end: None,
            },
        )
        .await?;
    let token = meeting.share_token.clone();
    let first = harness
        .service
        .join_meeting(token.clone(), harness.host.copied())
        .await?;
    assert!(
        harness
            .leave(first.call_id, harness.host.copied())
            .await?
            .call_ended
    );

    let second = harness
        .service
        .join_meeting(token, harness.host.copied())
        .await?;
    assert!(second.started);
    assert_ne!(second.call_id, first.call_id);
    assert!(
        harness
            .leave(second.call_id, harness.host.copied())
            .await?
            .call_ended
    );
    assert_eq!(records_for_meeting(&pool, meeting.id).await?, 2);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn without_the_resume_gate_a_rejoined_scheduled_meeting_is_two_calls(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let harness = Harness::new(&pool, false).await?;
    let meeting = harness.scheduled_meeting().await?;
    let token = meeting.share_token.clone();
    let first = harness
        .service
        .join_meeting(token.clone(), harness.host.copied())
        .await?;
    assert!(
        harness
            .leave(first.call_id, harness.host.copied())
            .await?
            .call_ended
    );

    let second = harness
        .service
        .join_meeting(token, harness.attendee.copied())
        .await?;
    assert!(second.started);
    assert_ne!(second.call_id, first.call_id);
    assert!(
        harness
            .leave(second.call_id, harness.attendee.copied())
            .await?
            .call_ended
    );
    assert_eq!(records_for_meeting(&pool, meeting.id).await?, 2);
    assert_eq!(harness.published("call.started", first.call_id), 1);
    assert_eq!(harness.published("call.started", second.call_id), 1);
    Ok(())
}
