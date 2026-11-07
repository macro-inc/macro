//! Call session authorization for the shared guest discussion boundary.
use super::*;
use crate::domain::meetings::GuestId;
use messages::domain::{
    ports::MessageError,
    service::guest_chat::{GuestCallAccess, GuestCallAuthorizer},
};

#[async_trait::async_trait]
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
> GuestCallAuthorizer for CallServiceImpl<R, C, Cn, E, N, S, Sm, V, Vr, B>
{
    #[tracing::instrument(err, skip_all, fields(%call_id))]
    async fn authorize(&self, call_id: Uuid, token: &str) -> Result<GuestCallAccess, MessageError> {
        let verified = self
            .rtc_client
            .verify_access_token(token)
            .map_err(|_| MessageError::Forbidden)?;
        let guest_id =
            GuestId::parse_rtc_identity(&verified.identity).ok_or(MessageError::Forbidden)?;
        let call = self
            .repo
            .get_call_by_id(&call_id)
            .await
            .map_err(|e| {
                MessageError::Repository(rootcause::report!(CallError::Internal(e.into())).into())
            })?
            .ok_or(MessageError::Forbidden)?;
        if call.channel_id.is_some() || verified.room.as_deref() != Some(call.room_name.as_str()) {
            return Err(MessageError::Forbidden);
        }
        let guests = self.repo.get_active_guests(&call_id).await.map_err(|e| {
            MessageError::Repository(rootcause::report!(CallError::Internal(e.into())).into())
        })?;
        if !guests.iter().any(|(id, _)| *id == guest_id) {
            return Err(MessageError::Forbidden);
        }
        // RTC membership closes the webhook-delay window after a guest disconnects.
        let participants = self
            .rtc_client
            .list_meeting_participants(&call.room_name)
            .await
            .map_err(|_| MessageError::Forbidden)?
            .ok_or(MessageError::Forbidden)?;
        let participant = participants
            .into_iter()
            .find(|participant| participant.identity == verified.identity)
            .ok_or(MessageError::Forbidden)?;
        Ok(GuestCallAccess {
            guest_id: guest_id.as_uuid(),
            name: participant.name,
        })
    }
}
