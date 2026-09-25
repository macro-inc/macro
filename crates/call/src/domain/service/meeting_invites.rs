//! Owner-authorized incoming call invitations for registered teammates.

use super::*;
use chrono::{TimeDelta, Utc};

const MEETING_RING_DURATION: TimeDelta = TimeDelta::seconds(30);

fn may_invite(meeting: &Meeting, actor: &MacroUserIdStr<'_>) -> bool {
    meeting.channel_id.is_none() && meeting.user_id == actor.as_ref()
}

impl<R, C, Cn, E, N, S, Sm, V, Vr, B> CallServiceImpl<R, C, Cn, E, N, S, Sm, V, Vr, B>
where
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
{
    #[tracing::instrument(err, skip_all)]
    pub(super) async fn meeting_invite_permissions(
        &self,
        actor: MacroUserIdStr<'_>,
        token: MeetingToken,
    ) -> Result<MeetingInvitePermissions, CallError> {
        let meeting = self.resolve_invitation(&token).await?;
        Ok(MeetingInvitePermissions {
            can_invite: may_invite(&meeting, &actor) && meeting.call_id.is_some(),
        })
    }

    #[tracing::instrument(err, skip_all)]
    pub(super) async fn ring_meeting_invitation(
        &self,
        actor: MacroUserIdStr<'_>,
        token: MeetingToken,
        request: InviteMeetingUsersRequest,
    ) -> Result<(), CallError> {
        let meeting = self.resolve_invitation(&token).await?;
        if !may_invite(&meeting, &actor) {
            return Err(CallError::Forbidden(
                "Only the meeting owner can invite teammates to a standalone call".to_string(),
            ));
        }
        let call_id = meeting.call_id.ok_or_else(|| {
            CallError::InvalidRequest("Start the call before inviting teammates".to_string())
        })?;
        let mut recipients = request.recipients(&actor)?;
        let actor_team = self
            .entity_access_service
            .get_user_team(&actor)
            .await
            .map_err(|error| CallError::Internal(error.into()))?
            .ok_or_else(|| CallError::Forbidden("Join a team to invite teammates".to_string()))?;

        // Validate the entire bounded batch before delivering any invitation.
        for recipient in &recipients {
            let team = self
                .entity_access_service
                .get_user_team(recipient)
                .await
                .map_err(|error| CallError::Internal(error.into()))?;
            if team.is_none_or(|team| team.team_id != actor_team.team_id) {
                return Err(CallError::Forbidden(
                    "Call invitations can only be sent to your teammates".to_string(),
                ));
            }
        }
        let participants = self
            .repo
            .get_participants(&call_id)
            .await
            .map_err(|error| CallError::Internal(error.into()))?;
        recipients.retain(|recipient| {
            !participants
                .iter()
                .any(|participant| participant.user_id == recipient.as_ref())
        });
        if recipients.is_empty() {
            return Ok(());
        }

        // Persist session-scoped discovery before publishing so Live survives
        // a dismissed or missed notification.
        self.repo
            .add_meeting_invitees(&meeting.id, &call_id, &recipients)
            .await?;

        let invited_at = Utc::now();
        self.connection_service
            .send_channel_message(
                &recipients,
                "meeting_invited",
                serde_json::json!({
                    "meeting_id": meeting.id,
                    "share_token": token,
                    "title": meeting.title,
                    "created_by": actor,
                    "invited_at": invited_at,
                    "expires_at": invited_at + MEETING_RING_DURATION,
                }),
            )
            .await
            .map_err(|error| CallError::Internal(error.into()))
    }

    /// Resolve this user's incoming meeting invitation on all their devices.
    pub(super) async fn send_meeting_answered_event(
        &self,
        meeting_id: Uuid,
        actor: MacroUserIdStr<'_>,
    ) {
        self.connection_service
            .send_channel_message(
                &[actor.copied()],
                "meeting_answered",
                serde_json::json!({ "meeting_id": meeting_id, "user_id": actor }),
            )
            .await
            .inspect_err(
                |error| tracing::error!(error = ?error, "failed to send meeting answered event"),
            )
            .ok();
    }
}
