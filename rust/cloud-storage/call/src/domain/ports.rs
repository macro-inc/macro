//! Port definitions for the call domain.
//!
//! These traits define the contracts that adapters must implement.

use std::fmt::Debug;
use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    Call, CallActiveResponse, CallError, CallParticipant, CallTokenResponse, CallWebhookEvent,
    EgressS3Config, LeaveCallResponse, TranscriptSegmentRequest,
};

/// Repository port for persisting call state to the database.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait CallRepository: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + Debug;

    /// Create a new call record, or return `None` if one already exists for
    /// this channel (unique-constraint conflict).
    fn create_call<'a>(
        &self,
        call_id: &Uuid,
        channel_id: &Uuid,
        room_name: &str,
        created_by: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<Call>, Self::Err>> + Send;

    /// Get an active call by channel ID.
    fn get_call_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> impl Future<Output = Result<Option<Call>, Self::Err>> + Send;

    /// Check whether an active call exists for a channel. Queries `calls` table only.
    fn get_active_call_by_channel(
        &self,
        channel_id: &Uuid,
    ) -> impl Future<Output = Result<Option<Call>, Self::Err>> + Send;

    /// Get an active call by its RTC room name.
    fn get_call_by_room_name(
        &self,
        room_name: &str,
    ) -> impl Future<Output = Result<Option<Call>, Self::Err>> + Send;

    /// Add a participant to a call.
    fn add_participant<'a>(
        &self,
        call_id: &Uuid,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<CallParticipant, Self::Err>> + Send;

    /// Remove a participant from a call.
    fn remove_participant<'a>(
        &self,
        call_id: &Uuid,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get all active participants for a call.
    fn get_participants(
        &self,
        call_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<CallParticipant>, Self::Err>> + Send;

    /// Get the count of active participants in a call.
    fn get_participant_count(
        &self,
        call_id: &Uuid,
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// Check if a user is already a participant in a call.
    fn is_participant(
        &self,
        call_id: &Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Delete a call record (when the call ends).
    fn delete_call(&self, call_id: &Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Set the egress (recording) ID on an active call.
    fn set_egress_id(
        &self,
        call_id: &Uuid,
        egress_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Archive an active call to the permanent `call_records` and
    /// `call_record_participants` tables, then delete the ephemeral rows.
    /// Returns the new `call_records` id.
    fn archive_call(&self, call_id: &Uuid) -> impl Future<Output = Result<Uuid, Self::Err>> + Send;

    /// Set the recording URL on an archived call record.
    fn set_recording_url(
        &self,
        call_record_id: &Uuid,
        recording_url: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Find a call record by its egress ID (for webhook handling).
    fn get_call_record_by_egress_id(
        &self,
        egress_id: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Set the recording URL on an active call (by egress ID).
    ///
    /// Used when `egress_ended` arrives before the call is archived.
    /// Returns `true` if a matching active call was found and updated.
    fn set_active_call_recording_url(
        &self,
        egress_id: &str,
        recording_url: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Insert a transcript segment for an active call.
    fn create_transcript_segment(
        &self,
        call_id: &Uuid,
        segment: &TranscriptSegmentRequest,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get the profile picture URL for a user by their `MacroUserIdStr`.
    fn get_user_profile_picture<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}

/// RTC client port for interacting with the real-time communication service (e.g., LiveKit).
#[cfg_attr(test, mockall::automock)]
pub trait CallRtcClient: Send + Sync + 'static {
    /// Create a new RTC room with the given name.
    fn create_room(&self, room_name: &str) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Delete an RTC room.
    fn delete_room(&self, room_name: &str) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Generate an access token for a participant to join a room.
    fn generate_token<'a>(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'a>,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Remove a participant from a room.
    fn remove_participant<'a>(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'a>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Start a room composite egress (recording). Returns the egress ID.
    fn start_room_composite_egress(
        &self,
        room_name: &str,
        s3_config: &EgressS3Config,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Stop an active egress by ID.
    fn stop_egress(&self, egress_id: &str) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Validate a webhook signature and parse the event from the raw body.
    fn receive_webhook(&self, body: &str, auth_token: &str) -> Result<CallWebhookEvent, CallError>;

    /// Dispatch the transcription agent to a room (best-effort).
    ///
    /// Returns `Ok(())` if dispatch succeeded or if no agent is configured.
    fn dispatch_transcription_agent(
        &self,
        room_name: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Service interface for call operations.
pub trait CallService: Send + Sync + 'static {
    /// Validate an internal call token (e.g. from the `x-macro-internal-call` header).
    fn validate_internal_call(&self, token: &str) -> bool;

    /// Check if an active call exists for a channel.
    /// Returns the call info if active, or `None` if no call exists.
    fn check_active_call(
        &self,
        channel_id: &Uuid,
    ) -> impl Future<Output = Result<Option<CallActiveResponse>, CallError>> + Send;

    /// Get or create a call in a channel. If a call already exists, joins it;
    /// otherwise creates a new one. Always returns a join token.
    fn get_or_create_call(
        &self,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<CallTokenResponse, CallError>> + Send;

    /// Leave or end a call. Removes the user; if last participant, also deletes the room and call.
    fn leave_or_end_call<'a>(
        &self,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<LeaveCallResponse, CallError>> + Send;

    /// Validate and process a raw webhook event from the RTC provider.
    fn process_webhook_event(
        &self,
        body: &str,
        auth_token: &str,
    ) -> impl Future<Output = Result<(), CallError>> + Send;

    /// Ingest a transcript segment from the LiveKit Agent STT pipeline.
    fn ingest_transcript_segment(
        &self,
        channel_id: &Uuid,
        segment: TranscriptSegmentRequest,
    ) -> impl Future<Output = Result<(), CallError>> + Send;
}
