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
    async fn get_or_create_call(
        &self,
        channel_id: &Uuid,
        user_id: &str,
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

                // Create RTC room first.
                self.rtc_client
                    .create_room(&room_name)
                    .await
                    .map_err(CallError::Internal)?;

                // Create call record in DB.
                self.repo
                    .create_call(&call_id, channel_id, &room_name, user_id)
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?
            }
        };

        // Add as participant if not already in the call.
        if !self
            .repo
            .is_participant(&call.id, user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
        {
            self.repo
                .add_participant(&call.id, user_id)
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
            channel_id: *channel_id,
            token,
            room_name: call.room_name,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn leave_or_end_call(
        &self,
        channel_id: &Uuid,
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
            .is_participant(&call.id, user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        if !is_in_call {
            return Err(CallError::NotInCall);
        }

        // Remove participant from DB.
        self.repo
            .remove_participant(&call.id, user_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

        // Remove from RTC (best-effort).
        // LiveKit will fire participant_left and eventually room_finished webhooks,
        // which handle call record archival and cleanup of the ephemeral tables.
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
            .get_participant_count(&call.id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;

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
                    self.repo
                        .archive_call(&call.id)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?;
                }
            }
            "participant_joined" => {
                tracing::info!(
                    room_name = ?event.room_name,
                    participant = ?event.participant_identity,
                    "participant joined via webhook"
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

                // Reconcile: remove participant from DB if still present (handles crash/disconnect).
                if self
                    .repo
                    .is_participant(&call.id, participant_identity)
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?
                {
                    self.repo
                        .remove_participant(&call.id, participant_identity)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?;
                }

                // If no participants remain, archive the call and delete the room.
                let remaining = self
                    .repo
                    .get_participant_count(&call.id)
                    .await
                    .map_err(|e| CallError::Internal(e.into()))?;

                if remaining == 0 {
                    tracing::info!(call_id = %call.id, room_name, "last participant left, archiving call");
                    self.repo
                        .archive_call(&call.id)
                        .await
                        .map_err(|e| CallError::Internal(e.into()))?;

                    self.rtc_client
                        .delete_room(room_name)
                        .await
                        .inspect_err(|e| tracing::error!(error=?e, "failed to delete RTC room"))
                        .ok();
                }
            }
            "egress_started" | "egress_updated" | "egress_ended" => {
                tracing::info!(
                    event_type = %event.event,
                    room_name = ?event.room_name,
                    "egress event"
                );
                // TODO: handle recording/streaming lifecycle events
            }
            _ => {
                tracing::debug!(event_type = %event.event, "unhandled webhook event type");
            }
        }

        Ok(())
    }
}
