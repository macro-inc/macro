//! Call service implementation.

use uuid::Uuid;

use super::models::{CallError, CallTokenResponse, LeaveCallResponse};
use super::ports::{CallRepository, CallRtcClient, CallService};

/// The concrete call service implementation.
pub struct CallServiceImpl<R: CallRepository, C: CallRtcClient> {
    repo: R,
    rtc_client: C,
}

impl<R: CallRepository, C: CallRtcClient> CallServiceImpl<R, C> {
    /// Create a new call service.
    pub fn new(repo: R, rtc_client: C) -> Self {
        Self { repo, rtc_client }
    }
}

impl<R: CallRepository, C: CallRtcClient> CallService for CallServiceImpl<R, C> {
    #[tracing::instrument(err, skip(self))]
    async fn create_call(
        &self,
        channel_id: Uuid,
        user_id: &str,
    ) -> Result<CallTokenResponse, CallError> {
        // Check if a call already exists for this channel.
        if self
            .repo
            .get_call_by_channel_id(channel_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .is_some()
        {
            return Err(CallError::AlreadyExists(channel_id.to_string()));
        }

        let call_id = Uuid::now_v7();
        let room_name = channel_id.to_string();

        // Create RTC room first.
        self.rtc_client
            .create_room(&room_name)
            .await
            .map_err(CallError::Internal)?;

        // Create call record in DB.
        let call = self
            .repo
            .create_call(call_id, channel_id, &room_name, user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        // Add creator as first participant.
        self.repo
            .add_participant(call.id, user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        // Generate RTC token for the creator.
        let token = self
            .rtc_client
            .generate_token(&room_name, user_id)
            .await
            .map_err(CallError::Internal)?;

        Ok(CallTokenResponse {
            call_id: call.id,
            channel_id,
            token,
            room_name,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn join_call(
        &self,
        channel_id: Uuid,
        user_id: &str,
    ) -> Result<CallTokenResponse, CallError> {
        let call = self
            .repo
            .get_call_by_channel_id(channel_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .ok_or_else(|| CallError::NotFound(channel_id.to_string()))?;

        // Add as participant if not already in the call.
        let already_joined = self
            .repo
            .is_participant(call.id, user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        if !already_joined {
            self.repo
                .add_participant(call.id, user_id)
                .await
                .map_err(|e| CallError::Internal(e.into()))?;
        }

        // Always generate a fresh token (supports reconnection from different devices).
        let token = self
            .rtc_client
            .generate_token(&call.room_name, user_id)
            .await
            .map_err(CallError::Internal)?;

        Ok(CallTokenResponse {
            call_id: call.id,
            channel_id,
            token,
            room_name: call.room_name,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn leave_or_end_call(
        &self,
        channel_id: Uuid,
        user_id: &str,
    ) -> Result<LeaveCallResponse, CallError> {
        let call = self
            .repo
            .get_call_by_channel_id(channel_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .ok_or_else(|| CallError::NotFound(channel_id.to_string()))?;

        // Verify user is in the call.
        let is_in_call = self
            .repo
            .is_participant(call.id, user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        if !is_in_call {
            return Err(CallError::NotInCall);
        }

        // Remove from DB.
        self.repo
            .remove_participant(call.id, user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        // Remove from RTC (best-effort).
        self.rtc_client
            .remove_participant(&call.room_name, user_id)
            .await
            .inspect_err(
                |e| tracing::error!(error=?e, "failed to remove participant from RTC room"),
            )
            .ok();

        // Check if this was the last participant.
        let remaining = self
            .repo
            .get_participant_count(call.id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        if remaining == 0 {
            // Delete the RTC room (best-effort).
            self.rtc_client
                .delete_room(&call.room_name)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to delete RTC room"))
                .ok();

            // Delete the call record.
            self.repo
                .delete_call(call.id)
                .await
                .map_err(|e| CallError::Internal(e.into()))?;

            return Ok(LeaveCallResponse { call_ended: true });
        }

        Ok(LeaveCallResponse { call_ended: false })
    }
}
