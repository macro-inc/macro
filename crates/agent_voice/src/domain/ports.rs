//! Capabilities implemented by composition-root and infrastructure adapters.

use super::model::{LeaseState, Result, VoiceLease, VoiceSessionId};
use async_trait::async_trait;
use macro_uuid::Uuid;

/// Facts supplied by the owning agent-session service.
#[async_trait]
pub trait AgentVoiceDirectory: Send + Sync + 'static {
    /// Whether this is served by Macro's in-memory harness.
    async fn is_macro_session(&self, session: Uuid) -> Result<bool>;
}

/// Shared, atomic controller claims; records contain no media credentials.
#[async_trait]
pub trait VoiceLeaseStore: Send + Sync + 'static {
    /// Atomically insert if absent; return the existing record if already held.
    async fn claim(&self, lease: &VoiceLease) -> Result<Option<VoiceLease>>;
    /// Read the shared record, including expired records awaiting cleanup.
    async fn get(&self, session: Uuid) -> Result<Option<VoiceLease>>;
    /// Change state only for this media session and expected current state.
    async fn transition(
        &self,
        session: Uuid,
        voice: VoiceSessionId,
        from: LeaseState,
        to: LeaseState,
    ) -> Result<bool>;
    /// Release only the matching media session, after room cleanup succeeded.
    async fn release(&self, session: Uuid, voice: VoiceSessionId) -> Result<()>;
}

/// Media provisioning; it owns no task execution or user authorization.
#[async_trait]
pub trait VoiceMedia: Send + Sync + 'static {
    /// Create a private room and dispatch the expected named worker once.
    async fn provision(&self, lease: &VoiceLease) -> Result<()>;
    /// Delete the private room. Already absent is success.
    async fn close(&self, lease: &VoiceLease) -> Result<()>;
    /// Whether the private room still exists after browser/worker departure.
    async fn is_open(&self, lease: &VoiceLease) -> Result<bool>;
    /// Mint browser join credentials, bounded by the remaining session lifetime.
    fn token(&self, lease: &VoiceLease, ttl_seconds: u32) -> Result<String>;
    /// Public media endpoint.
    fn url(&self) -> &str;
}
