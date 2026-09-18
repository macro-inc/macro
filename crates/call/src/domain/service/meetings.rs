//! Invitation use cases. Guests receive room access; signed-in attendees also receive call-only View access.

use super::*;
use crate::domain::meetings::{
    CreateMeetingRequest, GuestJoinRequest, Meeting, MeetingToken, is_guest_identity,
};
use rootcause::compat::boxed_error::IntoBoxedError;

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
        if let Some(meeting) = self.repo.get_meeting_for_call(&call_id).await? {
            // Channel links only describe the pinned active session.
            if meeting.channel_id.is_none() || record.is_active {
                return Ok(meeting);
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

    async fn prepare_meeting_call(&self, meeting: &Meeting) -> Result<Call, CallError> {
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
            self.rtc_client.dispatch_transcription_agent(&call.room_name).await
                .inspect_err(|error| tracing::error!(error=?error, "failed to dispatch meeting transcription agent")).ok();
            if let Some(config) = &self.egress_s3_config {
                match self
                    .rtc_client
                    .start_room_composite_egress(&call.room_name, config)
                    .await
                {
                    Ok(egress_id) => self
                        .repo
                        .set_egress_id(&call.id, &egress_id)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?,
                    Err(error) => tracing::error!(error=?error, "failed to record meeting"),
                }
            }
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
        }
        Ok(call)
    }

    pub(super) async fn join_invitation(
        &self,
        token: MeetingToken,
        actor: MacroUserIdStr<'_>,
    ) -> Result<CallTokenResponse, CallError> {
        let meeting = self.resolve_invitation(&token).await?;
        if let Some((active_call, channel)) = self
            .repo
            .find_active_call_for_user(actor.copied())
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            && Some(active_call) != meeting.call_id
        {
            return Err(CallError::AlreadyInCall(
                channel.unwrap_or(active_call).to_string(),
            ));
        }
        let call = self.prepare_meeting_call(&meeting).await?;
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

    pub(super) async fn join_guest_invitation(
        &self,
        token: MeetingToken,
        request: GuestJoinRequest,
    ) -> Result<CallTokenResponse, CallError> {
        let name = request.validate()?;
        let meeting = self.resolve_invitation(&token).await?;
        let call = self.prepare_meeting_call(&meeting).await?;
        let identity = format!("guest:{}", Uuid::now_v7());
        let rtc_token = self
            .rtc_client
            .generate_guest_token(&call.room_name, &identity, &name)
            .await
            .map_err(CallError::Internal)?;
        self.repo.add_guest(&call.id, &identity, &name).await?;
        Ok(CallTokenResponse {
            call_id: call.id,
            channel_id: call.channel_id,
            token: rtc_token,
            room_name: call.room_name,
            server_url: self.server_url.clone(),
            participant_id: identity,
            share_token: Some(token.into()),
        })
    }

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
            .get_meeting_for_call(&call.id)
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
        if is_guest_identity(&verified.identity) {
            self.rtc_client
                .remove_guest(&room, &verified.identity)
                .await
                .map_err(CallError::Internal)?;
            self.repo
                .reconcile_guest(&call.id, &verified.identity, false)
                .await?;
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
