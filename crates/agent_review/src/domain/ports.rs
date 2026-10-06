//! Capabilities used by review policy; no transport or storage clients live here.

use agent_session::domain::model::{AgentSession, AgentSessionId};
use async_trait::async_trait;
use uuid::Uuid;

use super::model::{Capture, Comparison, Result, Review, ReviewFile, ReviewId};

/// Durable aggregate storage with atomic version checks.
#[async_trait]
pub trait ReviewRepo: Send + Sync + 'static {
    /// Deleted sessions whose source bodies can now be reclaimed.
    async fn cleanup_sessions(&self) -> Result<Vec<AgentSessionId>>;
    /// Acknowledge source-body deletion; retries are harmless.
    async fn finish_cleanup(&self, session: AgentSessionId) -> Result<()>;
    /// Read the session's review. Sessions own one continuous review history.
    async fn load(&self, session: AgentSessionId) -> Result<Option<Review>>;
    /// Read one manifest and compact history headers. Omitted selects the latest.
    /// Unknown revisions retain the headers so the service can report NotFound.
    async fn load_view(
        &self,
        session: AgentSessionId,
        revision: Option<u32>,
    ) -> Result<Option<Review>>;
    /// Resolve a body reference only within this session and revision number.
    async fn file_content(
        &self,
        session: AgentSessionId,
        revision: u32,
        path: &str,
    ) -> Result<Option<String>>;
    /// Insert a new review or replace exactly `previous_version`. False is a race.
    async fn save(
        &self,
        review: &Review,
        previous_version: Option<i64>,
        capture_claim: Option<Uuid>,
    ) -> Result<bool>;
    /// Take a bounded capture lease, shared by all service replicas.
    async fn claim_capture(&self, session: AgentSessionId, claim: Uuid) -> Result<bool>;
    /// Release only this capture's lease.
    async fn release_capture(&self, session: AgentSessionId, claim: Uuid) -> Result<()>;
    /// Sessions with feedback pending dispatch, bounded for each worker pass.
    async fn pending_feedback(&self) -> Result<Vec<AgentSessionId>>;
    /// Atomically claim a message for delivery; expired leases may be retried.
    async fn claim_feedback(&self, session: AgentSessionId, message: Uuid) -> Result<bool>;
    /// Record delivery acknowledgement and release the lease.
    async fn finish_feedback(
        &self,
        session: AgentSessionId,
        message: Uuid,
        delivered: bool,
    ) -> Result<()>;
}

/// Immutable, session-scoped file bodies, independently retrievable by readers.
#[async_trait]
pub trait ReviewBodies: Send + Sync + 'static {
    /// Delete all bodies for a session after the owning session was deleted.
    async fn delete_session(&self, session: AgentSessionId) -> Result<()>;
    /// Store before publishing its manifest entry. Identical writes are harmless.
    async fn put(&self, session: AgentSessionId, content: &str, file: &ReviewFile) -> Result<()>;
    /// Fetch a body only after the service checked it belongs to this review.
    async fn get(&self, session: AgentSessionId, content: &str) -> Result<ReviewFile>;
}

/// A workspace or published PR source. It receives trusted persisted session data.
#[async_trait]
pub trait ReviewSource: Send + Sync + 'static {
    /// Read complete files at the requested comparison, without mutating git.
    async fn capture(&self, session: &AgentSession, comparison: &Comparison) -> Result<Capture>;
}

/// The existing session prompt queue, with access rechecked at delivery time.
#[async_trait]
pub trait ReviewFeedback: Send + Sync + 'static {
    /// Submit with `message` as its durable session action ID. Retries must deduplicate
    /// even when the original agent turn has already completed.
    async fn send(
        &self,
        session: AgentSessionId,
        user: &str,
        message: Uuid,
        prompt: String,
    ) -> Result<()>;
}

/// Notify readers through the existing authorized session audience.
#[async_trait]
pub trait ReviewEvents: Send + Sync + 'static {
    /// Code and discussion changes both invalidate the review manifest.
    async fn changed(&self, session: AgentSessionId, review: ReviewId) -> Result<()>;
}
