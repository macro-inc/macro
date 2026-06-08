//! Call service implementation.

#[cfg(test)]
mod test;

use connection::domain::ports::ConnectionService;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::apple::VoipPushPayload;
use notification::domain::models::apple::{
    APNSPushNotification, Alert, AlertDictionary, Aps, PushNotificationData,
};
use notification::domain::models::{
    NotifCollapseKey, Notification, NotificationExtIos, SendNotificationRequestBuilder,
};
use notification::domain::ports::VoipPushSender;
use notification::domain::service::NotificationIngress;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::domain::models::{
    EditCallRecordRequest, EditCallTranscriptRequest, VoipPushPayloadRequest,
};

use super::models::{
    AddParticipantError, CallActiveResponse, CallError, CallRecord, CallRecordTranscriptSegment,
    CallTokenResponse, CallTranscriptCustomSpeakerResult, EgressS3Config, EnrichedCallTranscript,
    GetBatchCallRecordPreviewRequest, GetBatchCallRecordPreviewResponse, GetCallRecordsRequest,
    LeaveCallResponse, TranscriptSegmentRequest,
};
use super::ports::{
    CallRecordQueryService, CallRepository, CallRtcClient, CallSearchIndexer, CallService,
    CallSummarizer, NoOpCallSearchIndexer, NoOpVoiceRepository, RecordingStorage, VoiceRepository,
};

/// The concrete call service implementation.
pub struct CallServiceImpl<
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer = NoopCallSummarizer,
    I: CallSearchIndexer = NoOpCallSearchIndexer,
    V: VoipPushSender = (),
    Vr: VoiceRepository = NoOpVoiceRepository,
> {
    repo: R,
    rtc_client: C,
    connection_service: Cn,
    entity_access_service: E,
    notification_ingress: N,
    recording_storage: S,
    search_indexer: I,
    server_url: String,
    egress_s3_config: Option<EgressS3Config>,
    internal_call_secret: Option<String>,
    summarizer: Option<Sm>,
    voip_push_sender: V,
    voice_repo: Vr,
}

impl<
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer,
> CallServiceImpl<R, C, Cn, E, N, S, Sm, NoOpCallSearchIndexer, (), NoOpVoiceRepository>
{
    /// Create a new call service.
    pub fn new(
        repo: R,
        rtc_client: C,
        connection_service: Cn,
        entity_access_service: E,
        notification_ingress: N,
        recording_storage: S,
        server_url: impl Into<String>,
    ) -> Self {
        Self {
            repo,
            rtc_client,
            connection_service,
            entity_access_service,
            notification_ingress,
            recording_storage,
            search_indexer: NoOpCallSearchIndexer,
            server_url: server_url.into(),
            egress_s3_config: None,
            internal_call_secret: None,
            summarizer: None,
            voip_push_sender: (),
            voice_repo: NoOpVoiceRepository,
        }
    }
}

impl<
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer,
    I: CallSearchIndexer,
    V: VoipPushSender,
    Vr: VoiceRepository,
> CallServiceImpl<R, C, Cn, E, N, S, Sm, I, V, Vr>
{
    /// Enable auto-recording with the given S3 configuration.
    pub fn with_egress(mut self, s3_config: EgressS3Config) -> Self {
        self.egress_s3_config = Some(s3_config);
        self
    }

    /// Set the shared secret used to validate internal call requests.
    pub fn with_internal_call_secret(mut self, secret: String) -> Self {
        self.internal_call_secret = Some(secret);
        self
    }

    /// Enable AI call summarization with the given [`CallSummarizer`]
    /// implementation. When unset, calls are never summarized.
    pub fn with_summarizer(mut self, summarizer: Sm) -> Self {
        self.summarizer = Some(summarizer);
        self
    }

    /// Attach a VoIP push sender so incoming-call PushKit notifications are
    /// delivered when a new call is created.
    pub fn with_voip_push_sender<V2: VoipPushSender>(
        self,
        sender: V2,
    ) -> CallServiceImpl<R, C, Cn, E, N, S, Sm, I, V2, Vr> {
        CallServiceImpl {
            repo: self.repo,
            rtc_client: self.rtc_client,
            connection_service: self.connection_service,
            entity_access_service: self.entity_access_service,
            notification_ingress: self.notification_ingress,
            recording_storage: self.recording_storage,
            search_indexer: self.search_indexer,
            server_url: self.server_url,
            egress_s3_config: self.egress_s3_config,
            internal_call_secret: self.internal_call_secret,
            summarizer: self.summarizer,
            voip_push_sender: sender,
            voice_repo: self.voice_repo,
        }
    }

    /// Swap the search indexer.
    pub fn with_search_indexer<I2: CallSearchIndexer>(
        self,
        indexer: I2,
    ) -> CallServiceImpl<R, C, Cn, E, N, S, Sm, I2, V, Vr> {
        CallServiceImpl {
            repo: self.repo,
            rtc_client: self.rtc_client,
            connection_service: self.connection_service,
            entity_access_service: self.entity_access_service,
            notification_ingress: self.notification_ingress,
            recording_storage: self.recording_storage,
            search_indexer: indexer,
            server_url: self.server_url,
            egress_s3_config: self.egress_s3_config,
            internal_call_secret: self.internal_call_secret,
            summarizer: self.summarizer,
            voip_push_sender: self.voip_push_sender,
            voice_repo: self.voice_repo,
        }
    }

    /// Swap the voice repository.
    pub fn with_voice_repo<Vr2: VoiceRepository>(
        self,
        voice_repo: Vr2,
    ) -> CallServiceImpl<R, C, Cn, E, N, S, Sm, I, V, Vr2> {
        CallServiceImpl {
            repo: self.repo,
            rtc_client: self.rtc_client,
            connection_service: self.connection_service,
            entity_access_service: self.entity_access_service,
            notification_ingress: self.notification_ingress,
            recording_storage: self.recording_storage,
            search_indexer: self.search_indexer,
            server_url: self.server_url,
            egress_s3_config: self.egress_s3_config,
            internal_call_secret: self.internal_call_secret,
            summarizer: self.summarizer,
            voip_push_sender: self.voip_push_sender,
            voice_repo,
        }
    }

    /// Send a call event to all channel members (best-effort).
    async fn send_call_event(
        &self,
        channel_id: &Uuid,
        message_type: &str,
        message: &serde_json::Value,
        triggered_by_user_id: Option<MacroUserIdStr<'_>>,
    ) {
        let channel_id_str = channel_id.to_string();
        let users = match self
            .entity_access_service
            .get_users_by_entity(&channel_id_str, EntityType::Channel)
            .await
        {
            Ok(users) => users,
            Err(e) => {
                tracing::error!(error=?e, "failed to fetch channel users for call event");
                return;
            }
        };

        let users: Vec<MacroUserIdStr<'_>> = users
            .into_iter()
            .filter_map(|u| {
                if triggered_by_user_id
                    .as_ref()
                    .is_some_and(|t| u.as_ref() == t.as_ref())
                {
                    None
                } else {
                    Some(u)
                }
            })
            .collect();

        let _ = self
            .connection_service
            .send_channel_message(&users, message_type, message.clone())
            .await
            .inspect_err(|e| tracing::error!(error=?e, message_type, "failed to send call event"));
    }

    /// Send an event to the active participants of a call (best-effort).
    ///
    /// Unlike [`Self::send_call_event`], which fans out to every member of
    /// the channel, this targets only users currently in the call — rows in
    /// `call_participants` with `left_at IS NULL`.
    async fn send_call_participant_event(
        &self,
        call_id: &Uuid,
        message_type: &str,
        message: &serde_json::Value,
    ) {
        let participants = match self.repo.get_participants(call_id).await {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(error=?e, "failed to fetch call participants for event");
                return;
            }
        };

        let users: Vec<MacroUserIdStr<'static>> = participants
            .into_iter()
            .filter_map(|p| {
                MacroUserIdStr::parse_from_str(&p.user_id)
                    .map(CowLike::into_owned)
                    .ok()
            })
            .collect();

        let _ = self
            .connection_service
            .send_channel_message(&users, message_type, message.clone())
            .await
            .inspect_err(|e| tracing::error!(error=?e, message_type, "failed to send call participant event"));
    }
}

fn exclude_voip_recipients<'a>(
    recipient_ids: HashSet<MacroUserIdStr<'a>>,
    voip_recipient_ids: &HashSet<MacroUserIdStr<'static>>,
) -> HashSet<MacroUserIdStr<'a>> {
    recipient_ids
        .into_iter()
        .filter(|recipient_id| {
            !voip_recipient_ids
                .iter()
                .any(|voip_recipient_id| voip_recipient_id.as_ref() == recipient_id.as_ref())
        })
        .collect()
}

#[derive(Serialize, Deserialize, Clone)]
struct CallStartedNotification {
    sender_profile_picture_url: Option<String>,
    channel_name: Option<String>,
}

impl Notification for CallStartedNotification {
    const TYPE_NAME: &'static str = "call-started";
}

impl NotificationExtIos for CallStartedNotification {
    type NotifData = PushNotificationData;

    fn collapse_key(&self, entity: &model_entity::Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(Self::TYPE_NAME).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &model_entity::Entity<'_>,
        notification_id: uuid::Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        Some(APNSPushNotification {
            aps: Aps {
                alert: Some(Alert::Dictionary(AlertDictionary {
                    title: Some(match &self.channel_name {
                        Some(name) => format!("Incoming Call in #{name}"),
                        None => "Incoming Call".to_string(),
                    }),
                    body: Some(format!(
                        "{} is calling you",
                        sender_id
                            .as_ref()
                            .map(|e| e.email_str())
                            .unwrap_or("Someone")
                    )),
                    ..Default::default()
                })),
                ..Default::default()
            },
            push_notification_data: PushNotificationData {
                notification_id,
                sender_profile_picture_url: self.sender_profile_picture_url.clone(),
            },
        })
    }
}

impl<
    R: CallRepository + Clone,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer + Clone,
    I: CallSearchIndexer,
    V: VoipPushSender,
    Vr: VoiceRepository + Clone,
> CallService for CallServiceImpl<R, C, Cn, E, N, S, Sm, I, V, Vr>
{
    fn validate_internal_call(&self, token: &str) -> bool {
        self.internal_call_secret
            .as_deref()
            .is_some_and(|secret| secret == token)
    }

    #[tracing::instrument(err, skip(self))]
    async fn check_active_call(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<CallActiveResponse>, CallError> {
        let call = self
            .repo
            .get_active_call_by_channel(channel_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        Ok(call.map(|c| CallActiveResponse {
            call_id: c.id,
            channel_id: c.channel_id,
            created_by: c.created_by,
            created_at: c.created_at,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_or_create_call(
        &self,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<CallTokenResponse, CallError> {
        let call = match self
            .repo
            .get_call_by_channel_id(channel_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
        {
            Some(existing) => existing,
            None => {
                let call_id = Uuid::now_v7();
                let room_name = channel_id.to_string();

                // Create RTC room (idempotent in LiveKit).
                self.rtc_client
                    .create_room(&room_name)
                    .await
                    .map_err(CallError::Internal)?;

                // Try to create call record; if another request won the race
                // the ON CONFLICT returns None — re-read the existing call.
                match self
                    .repo
                    .create_call(&call_id, channel_id, &room_name, user_id.copied())
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?
                {
                    Some(call) => {
                        // We are the creator — dispatch transcription agent (best-effort).
                        self.rtc_client
                            .dispatch_transcription_agent(&room_name)
                            .await
                            .inspect_err(|e| {
                                tracing::error!(error=?e, "failed to dispatch transcription agent")
                            })
                            .ok();

                        // Start recording if configured.
                        if let Some(s3_config) = &self.egress_s3_config {
                            match self
                                .rtc_client
                                .start_room_composite_egress(&room_name, s3_config)
                                .await
                            {
                                Ok(egress_id) => {
                                    self.repo
                                        .set_egress_id(&call.id, &egress_id)
                                        .await
                                        .map_err(|e| CallError::Internal(e.into()))?;
                                }
                                Err(e) => {
                                    tracing::error!(error=?e, "failed to start egress recording");
                                }
                            }
                        }

                        // Notify channel members about the new call (best-effort).
                        self.send_call_event(
                            channel_id,
                            "call_started",
                            &serde_json::json!({
                                "channel_id": channel_id,
                                "call_id": call.id,
                                "created_by": user_id,
                            }),
                            Some(user_id.copied()),
                        )
                        .await;

                        // Send push notification and VoIP push to channel members (best-effort).
                        let _: Result<(), anyhow::Error> = async {
                            let channel_name = self
                                .repo
                                .resolve_channel_name(channel_id, user_id.copied())
                                .await
                                .map_err(Into::into)?;

                            let channel_id_str = channel_id.to_string();
                            let recipient_ids: HashSet<MacroUserIdStr<'_>> = self
                                .entity_access_service
                                .get_users_by_entity(&channel_id_str, EntityType::Channel)
                                .await?
                                .into_iter()
                                .filter(|u| u.as_ref() != user_id.as_ref())
                                .collect();

                            let sender_profile_picture_url = self
                                .repo
                                .get_user_profile_picture(user_id.copied())
                                .await
                                .ok()
                                .flatten();

                            let caller_name = self
                                .repo
                                .get_user_display_name(user_id.copied())
                                .await
                                .ok()
                                .flatten()
                                .unwrap_or_else(|| user_id.email_str().to_string());

                            // Send VoIP push for the native iOS incoming-call sheet first.
                            // Recipients with successful VoIP delivery do not need the regular
                            // APNS alert banner as well.
                            let recipient_vec: Vec<MacroUserIdStr<'static>> = recipient_ids
                                .iter()
                                .cloned()
                                .map(CowLike::into_owned)
                                .collect();

                            // Resolve VoIP endpoints before minting tokens:
                            // users without PushKit endpoints should not get
                            // LiveKit tokens minted for them. If endpoint
                            // resolution fails, fall back to normal APNS for
                            // everyone rather than dropping the notification.
                            let voip_targets = match self
                                .voip_push_sender
                                .get_voip_push_targets(&recipient_vec)
                                .await
                            {
                                Ok(targets) => targets,
                                Err(e) => {
                                    tracing::error!(
                                        error=?e,
                                        "failed to resolve VoIP push targets; falling back to APNS"
                                    );
                                    Vec::new()
                                }
                            };
                            let voip_target_recipient_ids: Vec<MacroUserIdStr<'static>> =
                                voip_targets
                                    .iter()
                                    .map(|target| target.recipient_id.clone())
                                    .collect();

                            let voip_channel_name = channel_name.clone().unwrap_or_default();
                            let payloads = self
                                .rtc_client
                                .build_voip_push_payloads(VoipPushPayloadRequest {
                                    recipients: &voip_target_recipient_ids,
                                    room_name: &call.room_name,
                                    call_id: call.id,
                                    channel_id: &channel_id_str,
                                    channel_name: &voip_channel_name,
                                    caller_name: &caller_name,
                                    livekit_server_url: &self.server_url,
                                })
                                .await;

                            let mut payloads_by_recipient: HashMap<
                                MacroUserIdStr<'static>,
                                VoipPushPayload,
                            > = payloads.into_iter().collect();
                            // Rejoin resolved endpoints with successfully
                            // minted payloads. A failed token mint skips only
                            // that recipient's VoIP push.
                            let pushes = voip_targets
                                .into_iter()
                                .filter_map(|target| {
                                    payloads_by_recipient
                                        .remove(&target.recipient_id)
                                        .map(|payload| (target, payload))
                                })
                                .collect();

                            let voip_recipient_ids =
                                self.voip_push_sender.send_voip_pushes(pushes).await;

                            let apns_recipient_ids =
                                exclude_voip_recipients(recipient_ids, &voip_recipient_ids);

                            // APNS is the fallback/default path. Recipients
                            // with a successful VoIP delivery skip the regular
                            // alert to avoid duplicate incoming-call UI.
                            if !apns_recipient_ids.is_empty() {
                                let req = SendNotificationRequestBuilder {
                                    notification_entity: EntityType::Channel
                                        .with_entity_string(channel_id_str.clone()),
                                    notification: CallStartedNotification {
                                        sender_profile_picture_url,
                                        channel_name: channel_name.clone(),
                                    },
                                    sender_id: Some(user_id.copied()),
                                    recipient_ids: apns_recipient_ids,
                                }
                                .into_request()
                                .with_apns();

                                self.notification_ingress
                                    .send_notification(req)
                                    .await
                                    .map_err(|e| anyhow::anyhow!(e))?;
                            }

                            Ok(())
                        }
                        .await
                        .inspect_err(|e| {
                            tracing::error!(error=?e, "failed to send call started notification");
                        });

                        call
                    }
                    None => {
                        // Another request created the call — read the existing one.
                        self.repo
                            .get_call_by_channel_id(channel_id)
                            .await
                            .map_err(|e| CallError::Internal(e.into()))?
                            .ok_or_else(|| CallError::NotFound(channel_id.to_string()))?
                    }
                }
            }
        };

        // Enforce: a user can only be active in one call at a time. If the
        // user already has an active participation in a *different* call,
        // reject before we add them here.
        if let Some((other_call_id, other_channel_id)) = self
            .repo
            .find_active_call_for_user(user_id.copied())
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            && other_call_id != call.id
        {
            return Err(CallError::AlreadyInCall(other_channel_id.to_string()));
        }

        // Idempotent upsert — handles concurrent joins and rejoin after leave.
        // The DB-level partial unique index is the race-safe backstop: if a
        // concurrent request slipped past the pre-flight above, the adapter
        // returns AddParticipantError::UserAlreadyActive, which we translate
        // to a typed CallError::AlreadyInCall.
        match self.repo.add_participant(&call.id, user_id.copied()).await {
            Ok(_) => {}
            Err(AddParticipantError::UserAlreadyActive) => {
                let channel = self
                    .repo
                    .find_active_call_for_user(user_id.copied())
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?
                    .map(|(_, ch)| ch.to_string())
                    .unwrap_or_else(|| "unknown".to_string());
                return Err(CallError::AlreadyInCall(channel));
            }
            Err(AddParticipantError::Repository(e)) => {
                return Err(CallError::Internal(e));
            }
        }

        // Always generate a fresh token (supports reconnection from different devices).
        let token = self
            .rtc_client
            .generate_token(&call.room_name, user_id)
            .await
            .map_err(CallError::Internal)?;

        Ok(CallTokenResponse {
            call_id: call.id,
            channel_id: *channel_id,
            token,
            room_name: call.room_name,
            server_url: self.server_url.clone(),
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn leave_or_end_call(
        &self,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<LeaveCallResponse, CallError> {
        let call = self
            .repo
            .get_call_by_channel_id(channel_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .ok_or_else(|| CallError::NotFound(channel_id.to_string()))?;

        // Remove participant from DB (idempotent — no-op if already removed by webhook).
        self.repo
            .remove_participant(&call.id, user_id.copied())
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        // Kick from LiveKit. The resulting participant_left webhook
        // handles archival and room deletion.
        self.rtc_client
            .remove_participant(&call.room_name, user_id)
            .await
            .inspect_err(
                |e| tracing::error!(error=?e, "failed to remove participant from RTC room"),
            )
            .ok();

        let remaining = self.repo.get_participant_count(&call.id).await.unwrap_or(0);

        Ok(LeaveCallResponse {
            call_ended: remaining == 0,
        })
    }

    #[tracing::instrument(err, skip(self, body, auth_token))]
    async fn process_webhook_event(&self, body: &str, auth_token: &str) -> Result<(), CallError> {
        let event = self.rtc_client.receive_webhook(body, auth_token)?;

        tracing::info!(
            event_type = %event.event,
            event_id = %event.id,
            room_name = ?event.room_name,
            participant = ?event.participant_identity,
            "processing call webhook event"
        );

        match event.event.as_str() {
            "room_started" => {
                tracing::info!(room_name = ?event.room_name, "room started");
            }
            "room_finished" => {
                // Safety net: archive if not already handled by participant_left.
                if let Some(room_name) = &event.room_name
                    && let Some(call) = self
                        .repo
                        .get_call_by_room_name(room_name)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?
                {
                    tracing::info!(call_id = %call.id, room_name, "archiving call on room_finished");
                    let channel_id = call.channel_id;
                    self.repo
                        .archive_call(&call.id)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?;

                    // Fire-and-forget summarization now that the
                    // `call_records` row is persisted.
                    self.spawn_summarize_call(call.id);
                    self.spawn_process_voices_for_call(call.id);

                    if let Err(e) = self.search_indexer.enqueue_upsert(&call.id).await {
                        tracing::error!(error=?e, call_id=%call.id, "failed to enqueue call record for search indexing");
                    }

                    self.send_call_event(
                        &channel_id,
                        "call_ended",
                        &serde_json::json!({
                            "channel_id": channel_id,
                            "call_id": call.id,
                        }),
                        None,
                    )
                    .await;
                }
            }
            "participant_joined" => {
                let (Some(room_name), Some(participant_identity)) =
                    (&event.room_name, &event.participant_identity)
                else {
                    tracing::warn!(
                        "participant_joined webhook missing room_name or participant_identity"
                    );
                    return Ok(());
                };

                let Some(call) = self
                    .repo
                    .get_call_by_room_name(room_name)
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?
                else {
                    return Ok(());
                };

                // Reconcile: idempotent upsert (handles reconnect/race conditions).
                // UserAlreadyActive means our DB has the user active in
                // another call while LiveKit says they joined this one —
                // state drift. Don't fail the whole webhook; log and move on.
                match self
                    .repo
                    .add_participant(&call.id, participant_identity.copied())
                    .await
                {
                    Ok(_) => {
                        tracing::info!(
                            call_id = %call.id,
                            participant = participant_identity.as_ref(),
                            "reconciled participant_joined via webhook"
                        );
                    }
                    Err(AddParticipantError::UserAlreadyActive) => {
                        tracing::warn!(
                            call_id = %call.id,
                            participant = participant_identity.as_ref(),
                            "participant_joined webhook: user already active in another call; ignoring reconcile"
                        );
                    }
                    Err(AddParticipantError::Repository(e)) => {
                        return Err(CallError::Internal(e));
                    }
                }
            }
            "participant_left" => {
                let (Some(room_name), Some(participant_identity)) =
                    (&event.room_name, &event.participant_identity)
                else {
                    tracing::warn!(
                        "participant_left webhook missing room_name or participant_identity"
                    );
                    return Ok(());
                };

                let Some(call) = self
                    .repo
                    .get_call_by_room_name(room_name)
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?
                else {
                    // Call already archived, nothing to do.
                    return Ok(());
                };

                // Remove participant from DB (idempotent — no-op if already left).
                self.repo
                    .remove_participant(&call.id, participant_identity.copied())
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?;

                // If no participants remain, archive the call and delete the room.
                let remaining = self
                    .repo
                    .get_participant_count(&call.id)
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?;

                if remaining == 0 {
                    tracing::info!(call_id = %call.id, room_name, "last participant left, archiving call");
                    let channel_id = call.channel_id;
                    let egress_id = call.egress_id.clone();
                    self.repo
                        .archive_call(&call.id)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?;

                    // Fire-and-forget summarization now that the
                    // `call_records` row is persisted.
                    self.spawn_summarize_call(call.id);
                    self.spawn_process_voices_for_call(call.id);

                    if let Err(e) = self.search_indexer.enqueue_upsert(&call.id).await {
                        tracing::error!(error=?e, call_id=%call.id, "failed to enqueue call record for search indexing");
                    }

                    // Stop egress explicitly before deleting the room. DeleteRoom
                    // is expected to cascade-stop egress, but a failed or slow
                    // DeleteRoom can leave egress running and billing. Doing it
                    // first makes the runaway-billing case impossible.
                    if let Some(egress_id) = egress_id {
                        self.rtc_client
                            .stop_egress(&egress_id)
                            .await
                            .inspect_err(
                                |e| tracing::error!(error=?e, egress_id, "failed to stop egress"),
                            )
                            .ok();
                    }

                    self.rtc_client
                        .delete_room(room_name)
                        .await
                        .inspect_err(|e| tracing::error!(error=?e, "failed to delete RTC room"))
                        .ok();

                    self.send_call_event(
                        &channel_id,
                        "call_ended",
                        &serde_json::json!({
                            "channel_id": channel_id,
                            "call_id": call.id,
                        }),
                        None,
                    )
                    .await;
                }
            }
            "egress_started" | "egress_updated" => {
                tracing::info!(
                    event_type = %event.event,
                    egress_id = ?event.egress_id,
                    room_name = ?event.room_name,
                    "egress event"
                );
                // `egress_started` carries the wall-clock instant the encoder
                // actually began capturing. Persist it so the frontend can
                // anchor transcript-to-audio sync to the recording's true
                // origin instead of the call-creation timestamp (which lags
                // the recording start by the egress bootstrap window).
                if event.event == "egress_started" {
                    if let Some(egress_id) = &event.egress_id {
                        let started_at =
                            chrono::DateTime::<chrono::Utc>::from_timestamp(event.created_at, 0);
                        if let Some(started_at) = started_at {
                            self.repo
                                .set_recording_started_at_by_egress_id(egress_id, started_at)
                                .await
                                .map_err(|e| CallError::Internal(e.into()))?;
                        } else {
                            tracing::warn!(
                                egress_id,
                                created_at = event.created_at,
                                "egress_started webhook had unparseable created_at",
                            );
                        }
                    } else {
                        tracing::warn!("egress_started webhook missing egress_id");
                    }
                }
            }
            "egress_ended" => {
                let (Some(egress_id), Some(file_url)) = (&event.egress_id, &event.file_url) else {
                    tracing::warn!("egress_ended webhook missing egress_id or file_url");
                    return Ok(());
                };

                let recording_key = extract_recording_key(file_url);
                tracing::info!(egress_id, recording_key, "egress recording completed");

                // Find the archived call record by egress_id and update the recording key.
                if let Some(call_record_id) = self
                    .repo
                    .get_call_record_by_egress_id(egress_id)
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?
                {
                    self.repo
                        .set_recording_key(&call_record_id, recording_key)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?;
                } else {
                    // Call not yet archived — store on the active call so
                    // archive_call can carry it forward.
                    let updated = self
                        .repo
                        .set_active_call_recording_key(egress_id, recording_key)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?;
                    if !updated {
                        tracing::warn!(
                            egress_id,
                            "no active call or call record found for egress_id"
                        );
                    }
                }
            }
            _ => {
                tracing::debug!(event_type = %event.event, "unhandled webhook event type");
            }
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_record(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<CallRecord, CallError> {
        let entity = receipt.entity();
        if entity.entity_type != EntityType::Call {
            return Err(CallError::Internal(anyhow::anyhow!(
                "expected Call entity in receipt, got {:?}",
                entity.entity_type
            )));
        }
        let call_id = Uuid::parse_str(&entity.entity_id)
            .map_err(|_| CallError::Internal(anyhow::anyhow!("invalid call_id in receipt")))?;

        let user_id = receipt
            .get_authenticated_user()
            .map_err(|_| CallError::Auth)?;

        let mut record = self
            .repo
            .get_call_record_by_call_id(&call_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .ok_or_else(|| CallError::NotFound(call_id.to_string()))?;

        if let Some(recording_key) = &record.recording_key {
            record.recording_url = self
                .recording_storage
                .presign_recording_url(recording_key)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to presign recording URL"))
                .ok();
        }

        if let Some(preview_key) = &record.preview_key {
            record.recording_preview_url = self
                .recording_storage
                .presign_recording_preview_url(preview_key)
                .await
                .inspect_err(
                    |e| tracing::error!(error=?e, "failed to presign recording preview URL"),
                )
                .ok();
        }

        record.channel_name = self
            .repo
            .resolve_channel_name(&record.channel_id, user_id.copied())
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        Ok(record)
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_call_record(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<(), CallError> {
        let entity = receipt.entity();
        if entity.entity_type != EntityType::Call {
            return Err(CallError::Internal(anyhow::anyhow!(
                "expected Call entity in receipt, got {:?}",
                entity.entity_type
            )));
        }
        let call_id = Uuid::parse_str(&entity.entity_id)
            .map_err(|_| CallError::Internal(anyhow::anyhow!("invalid call_id in receipt")))?;

        // Look up channel_id before deletion to keep the search-remove message id unique.
        let channel_id = self
            .repo
            .get_call_record_by_call_id(&call_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .map(|r| r.channel_id);

        let storage_keys = self
            .repo
            .delete_call_record(&call_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        if let Some(channel_id) = channel_id
            && let Err(e) = self
                .search_indexer
                .enqueue_remove(&channel_id, &call_id)
                .await
        {
            tracing::error!(error=?e, call_id=%call_id, "failed to enqueue call record removal from search");
        }

        if let Some(storage_keys) = storage_keys {
            if let Some(key) = storage_keys.recording_key.as_deref() {
                self.recording_storage
                    .delete_recording(key)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, recording_key=%key, "failed to delete call recording from storage");
                    })
                    .ok();
            }

            let preview_key = storage_keys.preview_key.or_else(|| {
                storage_keys
                    .recording_key
                    .as_deref()
                    .and_then(derive_preview_key_from_recording_key)
            });

            if let Some(preview_key) = preview_key {
                self.recording_storage
                    .delete_recording_preview(&preview_key)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, preview_key=%preview_key, "failed to delete call recording preview from storage");
                    })
                    .ok();
            }
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self, segment))]
    async fn ingest_transcript_segment(
        &self,
        channel_id: &Uuid,
        segment: TranscriptSegmentRequest,
    ) -> Result<(), CallError> {
        if !segment.is_final {
            return Ok(());
        }

        let call = self
            .repo
            .get_call_by_channel_id(channel_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .ok_or_else(|| CallError::NotFound(channel_id.to_string()))?;

        // Attach a stable voice id to each transcript row. Reuse an earlier
        // voice id for the same diarized speaker in this call before falling
        // back to embedding-based upsert; this prevents creating a fresh
        // `voice.id` for every finalized utterance from the same user.
        // Failure to persist the embedding must not block transcript ingest —
        // log and continue without a voice id.
        let voice_id = match segment.embedding.as_deref() {
            Some(embedding) if !embedding.is_empty() => {
                let existing_voice_id = self
                    .repo
                    .get_transcript_voice_id_for_speaker(
                        &call.id,
                        &segment.speaker_id,
                        segment.diarized_speaker_id.as_deref(),
                    )
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "failed to look up existing speaker voice id")
                    })
                    .ok()
                    .flatten();

                match existing_voice_id {
                    Some(voice_id) => Some(voice_id),
                    None => self
                        .voice_repo
                        .upsert_voice(embedding)
                        .await
                        .inspect_err(
                            |e| tracing::error!(error=?e, "failed to upsert voice embedding"),
                        )
                        .ok(),
                }
            }
            _ => None,
        };

        self.repo
            .create_transcript_segment(&call.id, &segment, voice_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn edit_call_record(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        request: EditCallRecordRequest,
    ) -> Result<(), CallError> {
        let entity = receipt.entity();
        if entity.entity_type != EntityType::Call {
            return Err(CallError::Internal(anyhow::anyhow!(
                "expected Call entity in receipt, got {:?}",
                entity.entity_type
            )));
        }

        let call_id = macro_uuid::string_to_uuid(&entity.entity_id)
            .map_err(|_| CallError::Internal(anyhow::anyhow!("invalid call entity receipt")))?;

        self.repo
            .patch_call_record(&call_id, &request)
            .await
            .map_err(|e| CallError::Internal(e.into()))
    }

    #[tracing::instrument(err, skip(self, request), fields(num_assignments = request.assignments.len()))]
    async fn edit_call_transcript(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        request: EditCallTranscriptRequest,
    ) -> Result<(), CallError> {
        let entity = receipt.entity();
        if entity.entity_type != EntityType::Call {
            return Err(CallError::Internal(anyhow::anyhow!(
                "expected Call entity in receipt, got {:?}",
                entity.entity_type
            )));
        }

        let call_id = macro_uuid::string_to_uuid(&entity.entity_id)
            .map_err(|_| CallError::Internal(anyhow::anyhow!("invalid call entity receipt")))?;

        self.repo
            .patch_call_transcript_custom_speakers(&call_id, &request.assignments)
            .await
            .map_err(|e| CallError::Internal(e.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn toggle_share_with_team(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<bool, CallError> {
        let entity = receipt.entity();
        if entity.entity_type != EntityType::Call {
            return Err(CallError::Internal(anyhow::anyhow!(
                "expected Call entity in receipt, got {:?}",
                entity.entity_type
            )));
        }

        let call_id = macro_uuid::string_to_uuid(&entity.entity_id)
            .map_err(|_| CallError::Internal(anyhow::anyhow!("invalid call entity receipt")))?;

        let (new_value, channel_id) = self
            .repo
            .toggle_share_with_team(&call_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        self.send_call_participant_event(
            &call_id,
            "call_share_with_team_toggled",
            &serde_json::json!({
                "call_id": call_id,
                "channel_id": channel_id,
                "share_with_team": new_value,
                "toggled_by": receipt.get_authenticated_user().ok(),
            }),
        )
        .await;

        Ok(new_value)
    }

    #[tracing::instrument(err, skip(self, request, user_id), fields(num_call_ids = request.call_ids.len()))]
    async fn get_batch_call_record_previews<'a>(
        &self,
        request: GetBatchCallRecordPreviewRequest,
        user_id: MacroUserIdStr<'a>,
    ) -> Result<GetBatchCallRecordPreviewResponse, CallError> {
        let previews = self
            .repo
            .batch_get_call_record_previews(&request.call_ids, user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;
        Ok(GetBatchCallRecordPreviewResponse { previews })
    }

    #[tracing::instrument(err, skip(self))]
    async fn summarize_call(&self, call_id: &Uuid) -> Result<(), CallError> {
        // No summarizer configured — feature is off, silently succeed.
        let Some(summarizer) = self.summarizer.as_ref() else {
            return Ok(());
        };

        if let Err(e) = generate_and_persist_custom_speakers(&self.repo, summarizer, call_id).await
        {
            tracing::error!(error=?e, %call_id, "failed to generate custom speakers before summarization");
        }

        // Load the finalized call record after the custom-speaker step so the
        // summary prompt sees any newly persisted speaker overrides. May race
        // with deletion, in which case there's nothing to summarize — log and
        // move on.
        let Some(record) = self
            .repo
            .get_call_record_by_call_id(call_id)
            .await
            .inspect_err(|e| tracing::error!(error=?e, %call_id, "failed to load call record for summarization"))
            .map_err(|e| CallError::Internal(e.into()))?
        else {
            tracing::warn!(%call_id, "call record not found for summarization; skipping");
            return Ok(());
        };

        if record.transcript.is_empty() {
            tracing::info!(%call_id, "call has empty transcript; skipping summarization");
            return Ok(());
        }

        let Some(summary) = summarizer
            .summarize_call(call_id, record.transcript)
            .await
            .inspect_err(|e| tracing::error!(error=?e, %call_id, "call summarizer failed"))
            .map_err(|e| CallError::Internal(e.into()))?
        else {
            tracing::info!(
                %call_id,
                "summarizer returned no summary (uninformative transcript); skipping persistence"
            );
            return Ok(());
        };

        self.repo
            .insert_call_summary(call_id, &summary)
            .await
            .inspect_err(|e| tracing::error!(error=?e, %call_id, "failed to persist call summary"))
            .map_err(|e| CallError::Internal(e.into()))?;

        // Auto-generate a display name from the summary; only persisted when
        // the user has not already set one (`set_custom_name_if_null`). Best
        // effort — naming failures must not fail summarization.
        if record.custom_name.is_none() {
            match summarizer.generate_call_name(call_id, &summary).await {
                Ok(Some(name)) => {
                    if let Err(e) = self.repo.set_custom_name_if_null(call_id, &name).await {
                        tracing::error!(
                            error=?e, %call_id,
                            "failed to persist ai-generated call name"
                        );
                    }
                }
                Ok(None) => {
                    tracing::info!(
                        %call_id,
                        "ai call naming returned no title; leaving name unset"
                    );
                }
                Err(e) => {
                    tracing::error!(
                        error=?e, %call_id,
                        "ai call naming failed after summary; leaving name unset"
                    );
                }
            }
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_user_voices(&self, macro_user_id: &Uuid) -> Result<Vec<Uuid>, CallError> {
        self.voice_repo
            .get_user_voices(macro_user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))
    }

    #[tracing::instrument(err, skip(self, embedding))]
    async fn set_user_voice(
        &self,
        macro_user_id: &Uuid,
        embedding: &[f32],
    ) -> Result<Uuid, CallError> {
        let voice_id = self
            .voice_repo
            .upsert_voice(embedding)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;
        self.voice_repo
            .link_user_voice(macro_user_id, &voice_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;
        Ok(voice_id)
    }
}

impl<
    R: CallRepository + Clone,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer + Clone,
    I: CallSearchIndexer,
    V: VoipPushSender,
    Vr: VoiceRepository + Clone,
> CallServiceImpl<R, C, Cn, E, N, S, Sm, I, V, Vr>
{
    /// Fire-and-forget spawn of [`CallService::summarize_call`] for `call_id`.
    ///
    /// Called after the `call_records` row is persisted so that summarization
    /// can run off the request path without blocking call completion. The
    /// spawned task owns cloned handles to `repo` and `summarizer`; errors
    /// are logged, never propagated. When no summarizer is configured this is
    /// a no-op and no task is spawned.
    fn spawn_summarize_call(&self, call_id: Uuid) {
        let Some(summarizer) = self.summarizer.clone() else {
            return;
        };
        let repo = self.repo.clone();
        tokio::spawn(async move {
            if let Err(e) = generate_and_persist_custom_speakers(&repo, &summarizer, &call_id).await
            {
                tracing::error!(error=?e, %call_id, "failed to generate custom speakers before summarization");
            }

            let record = match repo.get_call_record_by_call_id(&call_id).await {
                Ok(Some(record)) => record,
                Ok(None) => {
                    tracing::warn!(%call_id, "call record not found for summarization; skipping");
                    return;
                }
                Err(e) => {
                    tracing::error!(error=?e, %call_id, "failed to load call record for summarization");
                    return;
                }
            };

            if record.transcript.is_empty() {
                tracing::info!(%call_id, "call has empty transcript; skipping summarization");
                return;
            }

            let summary = match summarizer.summarize_call(&call_id, record.transcript).await {
                Ok(Some(summary)) => summary,
                Ok(None) => {
                    tracing::info!(
                        %call_id,
                        "summarizer returned no summary (uninformative transcript); skipping persistence"
                    );
                    return;
                }
                Err(e) => {
                    tracing::error!(error=?e, %call_id, "failed to summarize call on completion");
                    return;
                }
            };

            if let Err(e) = repo.insert_call_summary(&call_id, &summary).await {
                tracing::error!(error=?e, %call_id, "failed to persist call summary");
                return;
            }

            if record.custom_name.is_none() {
                match summarizer.generate_call_name(&call_id, &summary).await {
                    Ok(Some(name)) => {
                        if let Err(e) = repo.set_custom_name_if_null(&call_id, &name).await {
                            tracing::error!(
                                error=?e, %call_id,
                                "failed to persist ai-generated call name"
                            );
                        }
                    }
                    Ok(None) => {
                        tracing::info!(
                            %call_id,
                            "ai call naming returned no title; leaving name unset"
                        );
                    }
                    Err(e) => {
                        tracing::error!(
                            error=?e, %call_id,
                            "ai call naming failed after summary; leaving name unset"
                        );
                    }
                }
            }
        });
    }

    /// Fire-and-forget spawn of finished-call voice enrollment.
    ///
    /// Called from `process_webhook_event` immediately after `archive_call`
    /// finalizes the `call_records` row. Voice ids for consistently diarized
    /// speakers are enrolled for the users who spoke them. This intentionally
    /// does not populate `custom_speaker`; AI speaker attribution is handled
    /// separately before summarization.
    fn spawn_process_voices_for_call(&self, call_record_id: Uuid) {
        let repo = self.repo.clone();
        let voice_repo = self.voice_repo.clone();
        tokio::spawn(async move {
            enroll_stable_speaker_voices_for_call_record(&repo, &voice_repo, call_record_id).await;
        });
    }
}

async fn generate_and_persist_custom_speakers<R, Sm>(
    repo: &R,
    summarizer: &Sm,
    call_record_id: &Uuid,
) -> anyhow::Result<()>
where
    R: CallRepository,
    Sm: CallSummarizer,
{
    let transcripts = repo
        .get_enhanced_call_record_transcripts(call_record_id)
        .await
        .map_err(Into::into)?;
    if transcripts.is_empty() {
        tracing::info!(%call_record_id, "call has empty archived transcript; skipping custom speaker generation");
        return Ok(());
    }

    let candidate_speakers = repo
        .get_call_participants_with_team_members(call_record_id)
        .await
        .map_err(Into::into)?;
    if candidate_speakers.is_empty() {
        tracing::info!(%call_record_id, "call has no candidate speakers; skipping custom speaker generation");
        return Ok(());
    }

    let assignments = summarizer
        .generate_custom_speakers(transcripts, candidate_speakers)
        .await
        .map_err(Into::into)?;
    if assignments.is_empty() {
        tracing::info!(%call_record_id, "custom speaker generation returned no assignments");
        return Ok(());
    }

    let num_assignments = assignments.len();
    repo.overwrite_custom_speakers(
        assignments
            .into_iter()
            .map(|result| (result.call_transcript_id, result.custom_speaker))
            .collect(),
    )
    .await
    .map_err(Into::into)?;

    tracing::info!(%call_record_id, num_assignments, "persisted generated custom speaker assignments");
    Ok(())
}

/// Enroll stable speaker voice ids observed in a freshly archived call.
///
/// For each `speaker_id` in the call transcript, the repository returns
/// candidates only when every transcript row for that speaker has the same
/// non-NULL `diarized_speaker_id`. All distinct non-NULL `voice_id`s on those
/// rows are linked to the resolved macro user in `macro_user_voice` via
/// [`VoiceRepository::link_user_voice`].
async fn enroll_stable_speaker_voices_for_call_record<R: CallRepository, Vr: VoiceRepository>(
    repo: &R,
    voice_repo: &Vr,
    call_record_id: Uuid,
) {
    let stable_voices = match repo
        .get_stable_speaker_voices_for_call_record(&call_record_id)
        .await
    {
        Ok(stable_voices) => stable_voices,
        Err(e) => {
            tracing::error!(
                error=?e, %call_record_id,
                "failed to load stable speaker voices for enrollment"
            );
            return;
        }
    };

    if stable_voices.is_empty() {
        return;
    }

    let total = stable_voices.len();
    let mut linked = 0usize;
    for (macro_user_id, voice_id) in stable_voices {
        match voice_repo.link_user_voice(&macro_user_id, &voice_id).await {
            Ok(()) => linked += 1,
            Err(e) => tracing::error!(
                error=?e, %call_record_id, %macro_user_id, %voice_id,
                "failed to link stable speaker voice to user"
            ),
        }
    }

    tracing::info!(
        %call_record_id, linked, total,
        "stable speaker voice enrollment completed"
    );
}

/// Extract the recording key from a full S3 URL.
///
/// Given `https://bucket.s3.amazonaws.com/calls/UUID/TIMESTAMP.mp4`,
/// returns `UUID/TIMESTAMP.mp4`. Falls back to the full URL if it does
/// not contain the `calls/` prefix.
fn extract_recording_key(file_url: &str) -> &str {
    file_url
        .find("calls/")
        .map(|idx| &file_url[idx + "calls/".len()..])
        .unwrap_or(file_url)
}

fn derive_preview_key_from_recording_key(recording_key: &str) -> Option<String> {
    let recording_key = recording_key
        .strip_prefix("calls/")
        .unwrap_or(recording_key);
    let (parent, file_name) = recording_key.rsplit_once('/')?;
    if parent.is_empty() || file_name.is_empty() {
        return None;
    }
    Some(format!("calls/{parent}/{file_name}/PREVIEW.jpg"))
}

/// Zero-sized placeholder implementation of [`CallSummarizer`].
///
/// [`CallServiceImpl`]'s summarizer generic defaults to this type so callers
/// that do not wire an AI summarizer can simply leave the `summarizer` field
/// as `None`. The implementation itself is never executed — [`CallServiceImpl`]
/// only invokes `summarize_call` when `summarizer.is_some()`, and this
/// placeholder is exclusively used as the type parameter when the field is
/// `None`. If it is ever called, that is a programming error.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopCallSummarizer;

impl CallSummarizer for NoopCallSummarizer {
    type Err = anyhow::Error;

    async fn summarize_call(
        &self,
        _call_id: &Uuid,
        _transcript: Vec<CallRecordTranscriptSegment>,
    ) -> Result<Option<String>, Self::Err> {
        // Type-placeholder only — [`CallServiceImpl`] must never invoke this
        // when `summarizer` is `None`, and [`NoopCallSummarizer`] is never a
        // `Some(_)` value in practice.
        unreachable!(
            "NoopCallSummarizer::summarize_call invoked; it exists only as a type placeholder when the optional summarizer is None"
        )
    }

    async fn generate_call_name(
        &self,
        _call_id: &Uuid,
        _summary: &str,
    ) -> Result<Option<String>, Self::Err> {
        unreachable!(
            "NoopCallSummarizer::generate_call_name invoked; it exists only as a type placeholder when the optional summarizer is None"
        )
    }

    async fn generate_custom_speakers(
        &self,
        _transcript: Vec<EnrichedCallTranscript>,
        _candidate_speakers: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<CallTranscriptCustomSpeakerResult>, Self::Err> {
        unreachable!(
            "NoopCallSummarizer::generate_custom_speakers invoked; it exists only as a type placeholder when the optional summarizer is None"
        )
    }
}

/// Lightweight implementation of [`CallRecordQueryService`] for read-only
/// call record queries. Unlike [`CallServiceImpl`], this only requires a
/// repository — no RTC client, notifications, or entity access.
pub struct CallRecordQueryServiceImpl<R: CallRepository> {
    repo: R,
}

impl<R: CallRepository> CallRecordQueryServiceImpl<R> {
    /// Create a new query service with the given repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R: CallRepository> CallRecordQueryService for CallRecordQueryServiceImpl<R> {
    #[tracing::instrument(err, skip(self))]
    async fn get_user_call_records(
        &self,
        req: GetCallRecordsRequest,
    ) -> Result<Vec<CallRecord>, CallError> {
        let filter = req.query.filter();
        self.repo
            .get_call_records_by_user(req.user_id.copied(), req.limit, filter)
            .await
            .map_err(|e| CallError::Internal(e.into()))
    }
}
