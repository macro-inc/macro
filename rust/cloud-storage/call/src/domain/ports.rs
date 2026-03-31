//! Port definitions for the call domain.
//!
//! These traits define the contracts that adapters must implement.

use std::fmt::Debug;
use std::future::Future;

use uuid::Uuid;

use super::models::{Call, CallError, CallParticipant, CallTokenResponse, LeaveCallResponse};

/// Repository port for persisting call state to the database.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait CallRepository: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + Debug;

    /// Create a new call record.
    fn create_call(
        &self,
        call_id: Uuid,
        channel_id: Uuid,
        room_name: &str,
        created_by: &str,
    ) -> impl Future<Output = Result<Call, Self::Err>> + Send;

    /// Get an active call by channel ID.
    fn get_call_by_channel_id(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Option<Call>, Self::Err>> + Send;

    /// Add a participant to a call.
    fn add_participant(
        &self,
        call_id: Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<CallParticipant, Self::Err>> + Send;

    /// Remove a participant from a call.
    fn remove_participant(
        &self,
        call_id: Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get all active participants for a call.
    fn get_participants(
        &self,
        call_id: Uuid,
    ) -> impl Future<Output = Result<Vec<CallParticipant>, Self::Err>> + Send;

    /// Get the count of active participants in a call.
    fn get_participant_count(
        &self,
        call_id: Uuid,
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// Check if a user is already a participant in a call.
    fn is_participant(
        &self,
        call_id: Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Delete a call record (when the call ends).
    fn delete_call(&self, call_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// RTC client port for interacting with the real-time communication service (e.g., LiveKit).
#[cfg_attr(test, mockall::automock)]
pub trait CallRtcClient: Send + Sync + 'static {
    /// Create a new RTC room with the given name.
    fn create_room(&self, room_name: &str) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Delete an RTC room.
    fn delete_room(&self, room_name: &str) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Generate an access token for a participant to join a room.
    fn generate_token(
        &self,
        room_name: &str,
        participant_identity: &str,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Remove a participant from a room.
    fn remove_participant(
        &self,
        room_name: &str,
        participant_identity: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Service interface for call operations.
pub trait CallService: Send + Sync + 'static {
    /// Create a new call in a channel, create the RTC room, and return a join token.
    fn create_call(
        &self,
        channel_id: Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<CallTokenResponse, CallError>> + Send;

    /// Join an existing call in a channel and return a join token.
    fn join_call(
        &self,
        channel_id: Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<CallTokenResponse, CallError>> + Send;

    /// Leave or end a call. Removes the user; if last participant, also deletes the room and call.
    fn leave_or_end_call(
        &self,
        channel_id: Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<LeaveCallResponse, CallError>> + Send;
}
