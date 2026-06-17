//! Port definitions for AI projections.

use std::fmt::Debug;
use std::future::Future;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::models::{
    AiProjectionGenerationRequested, ClaimProjectionGenerationRequest,
    ClaimProjectionGenerationResult, CompleteProjectionRequest, FailProjectionRequest,
    GenerateProjectionRequest, GeneratedProjection, MaterializeProjectionRequest,
    MaterializeProjectionResponse, ProjectionInstance, RawProjectionGenerationMessage,
    ReleaseProjectionClaimRequest, Result, ScheduleProjectionRequest,
    UpsertProjectionInstanceRequest,
};

/// Repository port for projection cache persistence and scheduling.
pub trait AiProjectionRepository: Send + Sync + 'static {
    /// Error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + Debug;

    /// Create a projection instance if it does not exist, or touch an existing instance.
    fn get_or_create_instance(
        &self,
        request: UpsertProjectionInstanceRequest,
    ) -> impl Future<Output = std::result::Result<ProjectionInstance, Self::Err>> + Send;

    /// Schedule a projection instance for background generation.
    fn schedule_generation(
        &self,
        request: ScheduleProjectionRequest,
    ) -> impl Future<Output = std::result::Result<(), Self::Err>> + Send;

    /// Check whether a user can access a team target.
    fn user_can_access_team(
        &self,
        user_id: MacroUserIdStr<'static>,
        team_id: String,
    ) -> impl Future<Output = std::result::Result<bool, Self::Err>> + Send;

    /// Claim the next due projection instance for enqueueing generation work.
    fn claim_next_due_projection(
        &self,
        now: DateTime<Utc>,
    ) -> impl Future<Output = std::result::Result<Option<ProjectionInstance>, Self::Err>> + Send;

    /// Claim a specific projection instance referenced by a queue message.
    fn claim_generation_by_cache_key(
        &self,
        request: ClaimProjectionGenerationRequest,
    ) -> impl Future<Output = std::result::Result<ClaimProjectionGenerationResult, Self::Err>> + Send;

    /// Release an enqueue-only claim after the queue message has been published.
    fn release_generation_claim(
        &self,
        request: ReleaseProjectionClaimRequest,
    ) -> impl Future<Output = std::result::Result<(), Self::Err>> + Send;

    /// Mark generation as successful and persist generated output.
    fn complete_generation(
        &self,
        request: CompleteProjectionRequest,
    ) -> impl Future<Output = std::result::Result<(), Self::Err>> + Send;

    /// Mark generation as failed and persist the error.
    fn fail_generation(
        &self,
        request: FailProjectionRequest,
    ) -> impl Future<Output = std::result::Result<(), Self::Err>> + Send;

    /// Delete expired projection instances and return the number removed.
    fn cleanup_expired(
        &self,
        now: DateTime<Utc>,
    ) -> impl Future<Output = std::result::Result<u64, Self::Err>> + Send;
}

/// Publisher port for projection generation requests.
pub trait AiProjectionGenerationPublisher: Send + Sync + 'static {
    /// Error type returned by publish operations.
    type Err: Into<anyhow::Error> + Send + Debug;

    /// Publish a request to generate the referenced projection.
    fn publish_generation_requested(
        &self,
        event: AiProjectionGenerationRequested,
    ) -> impl Future<Output = std::result::Result<(), Self::Err>> + Send;
}

/// Queue port used by the SQS-backed projection worker.
pub trait AiProjectionGenerationQueue: AiProjectionGenerationPublisher {
    /// Receive raw generation messages from the queue.
    fn receive_generation_messages(
        &self,
    ) -> impl Future<Output = std::result::Result<Vec<RawProjectionGenerationMessage>, Self::Err>> + Send;

    /// Delete a handled generation message from the queue.
    fn delete_generation_message(
        &self,
        receipt_handle: String,
    ) -> impl Future<Output = std::result::Result<(), Self::Err>> + Send;
}

/// Generator port for expensive AI materialization.
pub trait ProjectionGenerator: Send + Sync + 'static {
    /// Error type returned by generator operations.
    type Err: Into<anyhow::Error> + Send + Debug;

    /// Generate output for a projection instance.
    fn generate_projection(
        &self,
        request: GenerateProjectionRequest,
    ) -> impl Future<Output = std::result::Result<GeneratedProjection, Self::Err>> + Send;
}

/// Service port for app-facing projection materialization.
pub trait AiProjectionService: Send + Sync + 'static {
    /// Materialize a projection for an authenticated requester.
    fn materialize(
        &self,
        requester: MacroUserIdStr<'static>,
        request: MaterializeProjectionRequest,
    ) -> impl Future<Output = Result<MaterializeProjectionResponse>> + Send;
}
