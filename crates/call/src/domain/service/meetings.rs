//! Invitation use cases. Guests receive room access; signed-in attendees also receive call-only View access.

use super::*;
use crate::domain::meetings::{
    CreateMeetingRequest, GuestId, GuestJoinRequest, Meeting, MeetingToken,
};
use rootcause::compat::boxed_error::IntoBoxedError;
use tracing::Instrument;

impl<
    R: CallRepository + Clone,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer + Clone,
    V: VoipPushSender,
    Vr: VoiceRepository + Clone,
    B: MacroEventBroker + Clone,
> CallServiceImpl<R, C, Cn, E, N, S, Sm, V, Vr, B>
{
    /// Webhooks can beat the startup API response, especially if a call ends
    /// immediately. Correlate only standalone rooms whose UUID is their call ID.
    #[tracing::instrument(err, skip_all)]
    pub(super) async fn link_meeting_recording_webhook(
        &self,
        room_name: Option<&str>,
        egress_id: Option<&str>,
    ) -> Result<(), CallError> {
        let (Some(room_name), Some(egress_id)) = (room_name, egress_id) else {
            return Ok(());
        };
        let Ok(call_id) = Uuid::parse_str(room_name) else {
            return Ok(());
        };
        let record = self
            .repo
            .get_call_record_by_call_id(&call_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;
        if let Some(record) = record
            && record.channel_id.is_none()
            && record.room_name == room_name
        {
            self.repo
                .attach_meeting_recording(&call_id, egress_id)
                .await
                .map_err(|e| CallError::Internal(e.into()))?;
        }
        Ok(())
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn email_invitation(
        &self,
        actor: MacroUserIdStr<'_>,
        token: MeetingToken,
        email: String,
    ) -> Result<(), CallError> {
        let meeting = self.resolve_invitation(&token).await?;
        if meeting.user_id != actor.as_ref() {
            return Err(CallError::Forbidden(
                "Only the meeting owner can send invitations".to_string(),
            ));
        }
        // Email invitations admit guests; channel calls require Macro accounts.
        if meeting.channel_id.is_some() {
            return Err(CallError::Forbidden(
                "Channel calls cannot be shared with people outside Macro".to_string(),
            ));
        }
        let email = email.trim().to_lowercase();
        let recipient = MacroUserIdStr::try_from_email(&email)
            .map_err(|_| CallError::InvalidRequest("Enter a valid email address".to_string()))?
            .into_owned();
        self.notification_ingress
            .send_notification(
                SendNotificationRequestBuilder {
                    notification_entity: model_entity::EntityType::User
                        .with_entity_string(actor.to_string()),
                    secondary_notification_entity: None,
                    notification: invite_email::CallInvite {
                        title: meeting.title,
                        share_token: token.into(),
                        invited_by: actor.clone().into_owned(),
                        recipient_email: email,
                    },
                    sender_id: Some(actor),
                    recipient_ids: std::collections::HashSet::from([recipient]),
                }
                .into_request()
                .with_email(),
            )
            .await
            .map_err(|error| {
                CallError::Internal(anyhow::Error::from_boxed(error.into_boxed_error()))
            })?;
        Ok(())
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn create_invitation(
        &self,
        actor: MacroUserIdStr<'_>,
        request: CreateMeetingRequest,
    ) -> Result<Meeting, CallError> {
        let request = request.validate()?;
        self.repo
            .create_meeting(Meeting {
                id: Uuid::now_v7(),
                share_token: MeetingToken::generate(),
                title: request.title.unwrap_or_else(|| "Macro call".to_string()),
                scheduled_start: request.scheduled_start,
                scheduled_end: request.scheduled_end,
                channel_id: None,
                channel_call_id: None,
                call_id: None,
                user_id: actor.to_string(),
            })
            .await
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn share_invitation(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Meeting, CallError> {
        let call_id = Uuid::parse_str(&receipt.entity().entity_id)
            .map_err(|_| CallError::InvalidRequest("Invalid call id".to_string()))?;
        let record = self
            .repo
            .get_call_record_by_call_id(&call_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .ok_or_else(|| CallError::NotFound(call_id.to_string()))?;
        if let Some(meeting) = self.repo.get_meeting_for_call(&call_id, false).await? {
            // Channel links only describe the pinned active session.
            if meeting.channel_id.is_none() || record.is_active {
                return self.resolve_invitation(&meeting.share_token).await;
            }
        }
        if !record.is_active {
            return Err(CallError::NotFound("This call has ended".to_string()));
        }
        if record.channel_id.is_none() {
            return Err(CallError::NotFound("meeting".to_string()));
        }
        self.repo
            .create_meeting(Meeting {
                id: Uuid::now_v7(),
                share_token: MeetingToken::generate(),
                title: "Macro call".to_string(),
                scheduled_start: None,
                scheduled_end: None,
                channel_id: record.channel_id,
                channel_call_id: Some(call_id),
                call_id: Some(call_id),
                user_id: record.created_by,
            })
            .await
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn resolve_invitation(
        &self,
        token: &MeetingToken,
    ) -> Result<Meeting, CallError> {
        let meeting = self
            .repo
            .get_meeting(token)
            .await?
            .ok_or_else(|| CallError::NotFound("meeting".to_string()))?;
        if meeting.channel_call_id.is_some() && meeting.call_id != meeting.channel_call_id {
            return Err(CallError::NotFound("This call has ended".to_string()));
        }
        Ok(meeting)
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn preview_invitation(
        &self,
        token: MeetingToken,
        actor: Option<MacroUserIdStr<'_>>,
    ) -> Result<crate::domain::meetings::MeetingParticipants, CallError> {
        use crate::domain::meetings::{MeetingParticipant, MeetingParticipants};

        let meeting = self.resolve_invitation(&token).await?;
        if meeting.channel_id.is_some() && actor.is_none() {
            return Err(CallError::Forbidden(
                "Sign in to view this call".to_string(),
            ));
        }
        let mut participants = Vec::new();
        let Some(call_id) = meeting.call_id else {
            return Ok(MeetingParticipants { participants });
        };
        let Some(call) = self
            .repo
            .get_call_by_id(&call_id)
            .await
            .map_err(|error| CallError::Internal(error.into()))?
        else {
            return Ok(MeetingParticipants { participants });
        };
        let connected = self
            .rtc_client
            .list_meeting_participants(&call.room_name)
            .await
            .map_err(CallError::Internal)?
            .unwrap_or_default();
        for participant in connected {
            if let Ok(user) = MacroUserIdStr::parse_from_str(&participant.identity) {
                let display_name = self
                    .repo
                    .get_user_display_name(user.copied())
                    .await
                    .map_err(|error| CallError::Internal(error.into()))?
                    .unwrap_or_else(|| "Macro user".to_string());
                let avatar_url = self
                    .repo
                    .get_user_profile_picture(user)
                    .await
                    .map_err(|error| CallError::Internal(error.into()))?;
                participants.push(MeetingParticipant {
                    display_name,
                    avatar_url,
                });
            } else if GuestId::parse_rtc_identity(&participant.identity).is_some() {
                participants.push(MeetingParticipant {
                    display_name: if participant.name.trim().is_empty() {
                        "Guest".to_string()
                    } else {
                        participant.name
                    },
                    avatar_url: None,
                });
            }
        }
        participants.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        Ok(MeetingParticipants { participants })
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn prepare_meeting_call(&self, meeting: &Meeting) -> Result<Call, CallError> {
        if let Some(call_id) = meeting.call_id
            && let Some(call) = self
                .repo
                .get_call_by_id(&call_id)
                .await
                .map_err(|e| CallError::Internal(e.into()))?
        {
            return Ok(call);
        }
        let candidate_id = Uuid::now_v7();
        let candidate_room = candidate_id.to_string();
        self.rtc_client
            .create_room(&candidate_room)
            .await
            .map_err(CallError::Internal)?;
        let allocated = self
            .repo
            .get_or_create_meeting_call(&meeting.id, &candidate_id)
            .await;
        if !matches!(&allocated, Ok((_, true))) {
            self.rtc_client
                .delete_room(&candidate_room)
                .await
                .inspect_err(
                    |error| tracing::error!(error=?error, "failed to remove unused meeting room"),
                )
                .ok();
        }
        let (call, created) = allocated?;
        if created {
            let created_by = MacroUserIdStr::parse_from_str(&call.created_by)
                .map_err(|error| CallError::Internal(error.into()))?
                .into_owned();
            self.publish_call_event(&CallMacroEvent::started(CallStartedMetadata {
                call_id: call.id,
                channel_id: None,
                created_by,
                created_at: call.created_at,
                recording_enabled: self.egress_s3_config.is_some(),
            }));
            // Token issuance needs a room, not a running recorder or agent.
            // Only the allocation winner schedules these best-effort services.
            let rtc = self.rtc_client.clone();
            let repo = self.repo.clone();
            let config = self.egress_s3_config.clone();
            let room_name = call.room_name.clone();
            let call_id = call.id;
            tokio::spawn(async move {
                let transcription = async {
                    rtc.dispatch_transcription_agent(&room_name).await
                        .inspect_err(|error| tracing::error!(error=?error, "failed to dispatch meeting transcription agent")).ok();
                };
                let recording = start_meeting_recording(&repo, rtc.as_ref(), call_id, &room_name, config.as_ref());
                tokio::join!(transcription, recording);
            }.instrument(tracing::info_span!("start_meeting_media", call_id = %call_id)));
        }
        Ok(call)
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn join_invitation(
        &self,
        token: MeetingToken,
        actor: MacroUserIdStr<'_>,
    ) -> Result<CallTokenResponse, CallError> {
        let meeting = self.resolve_invitation(&token).await?;
        let call = self.prepare_meeting_call(&meeting).await?;
        self.leave_other_active_call(actor.copied(), call.id)
            .await?;
        let rtc_token = self
            .rtc_client
            .generate_token(&call.room_name, actor.copied())
            .await
            .map_err(CallError::Internal)?;
        match self
            .repo
            .add_meeting_participant(&call.id, actor.copied())
            .await
        {
            Ok(_) => {}
            Err(AddParticipantError::UserAlreadyActive) => {
                return Err(CallError::AlreadyInCall("another call".to_string()));
            }
            Err(AddParticipantError::Repository(error)) => return Err(CallError::Internal(error)),
        }
        self.send_meeting_answered_event(meeting.id, actor.copied())
            .await;
        Ok(CallTokenResponse {
            call_id: call.id,
            channel_id: call.channel_id,
            token: rtc_token,
            room_name: call.room_name,
            server_url: self.server_url.clone(),
            participant_id: actor.to_string(),
            share_token: Some(token.into()),
        })
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn join_guest_invitation(
        &self,
        token: MeetingToken,
        request: GuestJoinRequest,
    ) -> Result<CallTokenResponse, CallError> {
        let name = request.validate()?;
        let meeting = self.resolve_invitation(&token).await?;
        // A channel link cannot grant access to non-account guests.
        if meeting.channel_id.is_some() {
            return Err(CallError::Forbidden(
                "Sign in to join this call".to_string(),
            ));
        }
        let call = self.prepare_meeting_call(&meeting).await?;
        let guest_id = GuestId::generate();
        // Lock and persist before minting so a join racing archival fails here.
        self.repo.add_guest(&call.id, guest_id, &name).await?;
        let rtc_token = match self
            .rtc_client
            .generate_guest_token(&call.room_name, guest_id, &name)
            .await
        {
            Ok(token) => token,
            Err(error) => {
                // This guest never connected, so no webhook can release its row.
                self.repo
                    .reconcile_guest(&call.id, guest_id, false)
                    .await
                    .inspect_err(|e| tracing::error!(error=?e, "failed to release unminted guest"))
                    .ok();
                return Err(CallError::Internal(error));
            }
        };
        Ok(CallTokenResponse {
            call_id: call.id,
            channel_id: call.channel_id,
            token: rtc_token,
            room_name: call.room_name,
            server_url: self.server_url.clone(),
            participant_id: guest_id.to_string(),
            share_token: Some(token.into()),
        })
    }

    /// Leave the user's other active call and archive it if empty.
    #[tracing::instrument(err, skip(self))]
    pub(super) async fn leave_other_active_call(
        &self,
        user_id: MacroUserIdStr<'_>,
        joining: Uuid,
    ) -> Result<(), CallError> {
        let Some((other_call_id, _)) = self
            .repo
            .find_active_call_for_user(user_id.copied())
            .await
            .map_err(|e| CallError::Internal(e.into()))?
        else {
            return Ok(());
        };
        if other_call_id == joining {
            return Ok(());
        }
        let other = self
            .repo
            .get_call_by_id(&other_call_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .ok_or_else(|| CallError::NotFound(other_call_id.to_string()))?;
        self.repo
            .remove_participant(&other.id, user_id.copied())
            .await
            .map_err(|e| CallError::Internal(e.into()))?;
        // Best-effort: a stale participation has no RTC session to end.
        self.rtc_client
            .remove_participant(&other.room_name, user_id)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, "failed to remove participant from previous call room")
            })
            .ok();
        self.finish_empty_call(&other).await?;
        Ok(())
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn finish_empty_call(&self, call: &Call) -> Result<bool, CallError> {
        let remaining = self
            .repo
            .get_participant_count(&call.id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;
        if remaining != 0 {
            return Ok(false);
        }
        let archived = match self.repo.archive_call_if_empty(&call.id).await {
            Ok(Some(archived)) => archived,
            Ok(None) => return Ok(false),
            Err(CallError::NotFound(_)) => return Ok(true),
            Err(error) => return Err(error),
        };
        self.publish_archived_call_event(&archived, CallArchiveReason::LastParticipantLeft);
        self.spawn_summarize_call(archived.call_id);
        self.spawn_process_voices_for_call(archived.call_id);
        if let Some(egress_id) = &call.egress_id {
            self.rtc_client
                .stop_egress(egress_id)
                .await
                .inspect_err(|error| tracing::error!(error=?error, "failed to stop egress"))
                .ok();
        }
        self.rtc_client
            .delete_room(&call.room_name)
            .await
            .inspect_err(|error| tracing::error!(error=?error, "failed to delete RTC room"))
            .ok();
        self.send_call_event(
            &archived.channel_id,
            "call_ended",
            &serde_json::json!({
                "channel_id": archived.channel_id, "call_id": archived.call_id,
            }),
            None,
        )
        .await;
        Ok(true)
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn leave_invitation(
        &self,
        token: MeetingToken,
        bearer: &str,
    ) -> Result<LeaveCallResponse, CallError> {
        let verified = self
            .rtc_client
            .verify_access_token(bearer)
            .map_err(|_| CallError::Auth)?;
        // A cancelled invitation must still permit connected participants to leave.
        let room = verified.room.ok_or(CallError::Auth)?;
        let call = self
            .repo
            .get_call_by_room_name(&room)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .ok_or_else(|| CallError::NotFound("call".to_string()))?;
        let meeting = self
            .repo
            .get_meeting_for_call(&call.id, true)
            .await?
            .ok_or(CallError::Auth)?;
        if !bool::from(
            meeting
                .share_token
                .as_str()
                .as_bytes()
                .ct_eq(token.as_str().as_bytes()),
        ) {
            return Err(CallError::Auth);
        }
        if let Some(guest_id) = GuestId::parse_rtc_identity(&verified.identity) {
            self.rtc_client
                .remove_guest(&room, guest_id)
                .await
                .map_err(CallError::Internal)?;
            self.repo.reconcile_guest(&call.id, guest_id, false).await?;
        } else {
            let identity =
                MacroUserIdStr::parse_from_str(&verified.identity).map_err(|_| CallError::Auth)?;
            self.rtc_client
                .remove_participant(&room, identity.copied())
                .await
                .map_err(CallError::Internal)?;
            self.repo
                .remove_participant(&call.id, identity)
                .await
                .map_err(|e| CallError::Internal(e.into()))?;
        }
        Ok(LeaveCallResponse {
            call_ended: self.finish_empty_call(&call).await?,
        })
    }
}

/// A late recorder must be attached before stopping so its completion webhook
/// can find the archived record. Any failed attachment must also stop egress.
#[tracing::instrument(skip_all, fields(%call_id))]
pub(super) async fn start_meeting_recording<R: CallRepository, C: CallRtcClient>(
    repo: &R,
    rtc: &C,
    call_id: Uuid,
    room_name: &str,
    config: Option<&EgressS3Config>,
) {
    let Some(config) = config else {
        return;
    };
    let egress_id = match rtc.start_room_composite_egress(room_name, config).await {
        Ok(id) => id,
        Err(error) => {
            tracing::error!(error=?error, "failed to record meeting");
            return;
        }
    };
    let active = match repo.attach_meeting_recording(&call_id, &egress_id).await {
        Ok(true) => match repo.get_call_by_id(&call_id).await {
            Ok(call) => call.is_some(),
            Err(error) => {
                tracing::error!(error=?error, "failed to confirm meeting is still active");
                false
            }
        },
        Ok(false) => false,
        Err(error) => {
            tracing::error!(error=?error, "failed to attach meeting recording");
            false
        }
    };
    if !active {
        rtc.stop_egress(&egress_id)
            .await
            .inspect_err(
                |error| tracing::error!(error=?error, "failed to stop late meeting recording"),
            )
            .ok();
    }
}
