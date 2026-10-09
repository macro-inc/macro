//! Durable conversation segments for private persona DMs.

use macro_uuid::Uuid;

use super::{error::Result, model::AgentSessionId};

/// A context boundary in a DM's visible conversation history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentDmSegment {
    /// Session carrying this segment's agent context and controls.
    pub session_id: AgentSessionId,
    /// When this context began; older channel messages remain visible.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Whether new messages are addressed to this segment.
    pub is_current: bool,
}

/// Session-domain persistence for a DM's current and historical segments.
pub trait AgentDmConversationRepo: Send + Sync + 'static {
    /// Atomically reserve the current session identity, before runtime startup.
    /// Repeated or concurrent requests return the same id until an explicit reset.
    fn current_or_create(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<AgentSessionId>> + Send;

    /// Return the current segment without starting a conversation.
    fn current(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Option<AgentSessionId>>> + Send;

    /// Start a new segment while preserving every previous segment and its history.
    fn start_fresh(&self, channel_id: Uuid) -> impl Future<Output = Result<AgentSessionId>> + Send;

    /// Resolve the DM containing a session, including historical segments.
    fn channel_for_session(
        &self,
        session_id: AgentSessionId,
    ) -> impl Future<Output = Result<Option<Uuid>>> + Send;

    /// List all context segments, oldest first, without starting a runtime.
    fn segments(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<AgentDmSegment>>> + Send;
}
