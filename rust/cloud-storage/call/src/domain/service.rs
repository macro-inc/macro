//! Call service implementation.

use connection::domain::ports::ConnectionService;
use entity_access::domain::models::EntityType;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::apple::{
    APNSPushNotification, Alert, AlertDictionary, Aps, PushNotificationData,
};
use notification::domain::models::{
    NotifCollapseKey, Notification, NotificationExtIos, SendNotificationRequestBuilder,
};
use notification::domain::service::NotificationIngress;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

use super::models::{
    CallActiveResponse, CallError, CallTokenResponse, EgressS3Config, LeaveCallResponse,
    TranscriptSegmentRequest,
};
use super::ports::{CallRepository, CallRtcClient, CallService};

/// The concrete call service implementation.
pub struct CallServiceImpl<
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
> {
    repo: R,
    rtc_client: C,
    connection_service: Cn,
    entity_access_service: E,
    notification_ingress: N,
    server_url: String,
    egress_s3_config: Option<EgressS3Config>,
    internal_call_secret: Option<String>,
}

impl<
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
> CallServiceImpl<R, C, Cn, E, N>
{
    /// Create a new call service.
    pub fn new(
        repo: R,
        rtc_client: C,
        connection_service: Cn,
        entity_access_service: E,
        notification_ingress: N,
        server_url: impl Into<String>,
    ) -> Self {
        Self {
            repo,
            rtc_client,
            connection_service,
            entity_access_service,
            notification_ingress,
            server_url: server_url.into(),
            egress_s3_config: None,
            internal_call_secret: None,
        }
    }

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
}

#[derive(Serialize, Deserialize, Clone)]
struct CallStartedNotification {
    sender_profile_picture_url: Option<String>,
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
                    title: Some("Incoming Call".to_string()),
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
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
> CallService for CallServiceImpl<R, C, Cn, E, N>
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

                        // Send push notification to channel members (best-effort).
                        let channel_id_str = channel_id.to_string();
                        let recipient_ids: HashSet<MacroUserIdStr<'_>> = match self
                            .entity_access_service
                            .get_users_by_entity(&channel_id_str, EntityType::Channel)
                            .await
                        {
                            Ok(users) => users
                                .into_iter()
                                .filter(|u| u.as_ref() != user_id.as_ref())
                                .collect(),
                            Err(e) => {
                                tracing::error!(error=?e, "failed to fetch channel users for call notification");
                                HashSet::new()
                            }
                        };

                        let sender_profile_picture_url = self
                            .repo
                            .get_user_profile_picture(user_id.copied())
                            .await
                            .ok()
                            .flatten();

                        let req = SendNotificationRequestBuilder {
                            notification_entity: EntityType::Channel
                                .with_entity_string(channel_id_str),
                            notification: CallStartedNotification {
                                sender_profile_picture_url,
                            },
                            sender_id: Some(user_id.copied()),
                            recipient_ids,
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway();

                        let _ = self
                            .notification_ingress
                            .send_notification(req)
                            .await
                            .inspect_err(|e| {
                                tracing::error!(error=?e, "failed to send call started notification")
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

        // Idempotent upsert — handles concurrent joins and rejoin after leave.
        self.repo
            .add_participant(&call.id, user_id.copied())
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

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
                self.repo
                    .add_participant(&call.id, participant_identity.copied())
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?;
                tracing::info!(
                    call_id = %call.id,
                    participant = participant_identity.as_ref(),
                    "reconciled participant_joined via webhook"
                );
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
                    self.repo
                        .archive_call(&call.id)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?;

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
            }
            "egress_ended" => {
                let (Some(egress_id), Some(file_url)) = (&event.egress_id, &event.file_url) else {
                    tracing::warn!("egress_ended webhook missing egress_id or file_url");
                    return Ok(());
                };

                tracing::info!(egress_id, file_url, "egress recording completed");

                // Find the archived call record by egress_id and update the recording URL.
                if let Some(call_record_id) = self
                    .repo
                    .get_call_record_by_egress_id(egress_id)
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?
                {
                    self.repo
                        .set_recording_url(&call_record_id, file_url)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?;
                } else {
                    // Call not yet archived — store on the active call so
                    // archive_call can carry it forward.
                    let updated = self
                        .repo
                        .set_active_call_recording_url(egress_id, file_url)
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

        self.repo
            .create_transcript_segment(&call.id, &segment)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        Ok(())
    }
}
